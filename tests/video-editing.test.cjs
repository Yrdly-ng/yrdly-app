const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      source,
      {
        module,
        exports: module.exports,
        require: (name) => {
          if (Object.hasOwn(mocks, name)) return mocks[name];
          if (name.startsWith("."))
            return load(path.resolve(path.dirname(filename), name + ".ts"));
          throw Error("Unexpected dependency: " + name);
        },
        File,
        Blob,
        AbortController,
        AbortSignal,
        console,
        setTimeout,
        clearTimeout,
        ...mocks.globals,
      },
      { filename },
    );
    return module.exports;
  }
  return load;
}

const geometry = loader()("src/lib/media/video-editing.ts");
const metadata = { width: 800, height: 600, duration: 5 };
const edit = {
  start: 1,
  end: 3,
  crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
};

test("video trim and crop validation rejects unsafe bounds and non-finite values", () => {
  for (const invalid of [
    { ...edit, start: -1 },
    { ...edit, end: 6 },
    { ...edit, end: 1 },
    { ...edit, start: NaN },
    { ...edit, crop: { ...edit.crop, x: -0.1 } },
    { ...edit, crop: { ...edit.crop, y: 0.9 } },
    { ...edit, crop: { ...edit.crop, width: 0 } },
    { ...edit, crop: { ...edit.crop, height: Infinity } },
  ])
    assert.throws(() => geometry.validateVideoEdit(metadata, invalid));
  assert.doesNotThrow(() => geometry.validateVideoEdit(metadata, edit));
});

test("crop presets preserve aspect and movement keeps the whole crop inside the frame", () => {
  const crop = geometry.centeredVideoCrop(1920, 1080, 1, 0.5);
  assert.ok(Math.abs((crop.width * 1920) / (crop.height * 1080) - 1) < 1e-9);
  const moved = geometry.moveVideoCrop(crop, 100, -100);
  assert.equal(moved.y, 0);
  assert.equal(moved.x + moved.width, 1);
  const pixels = geometry.videoCropPixels(
    { width: 3840, height: 2160 },
    { x: 0, y: 0, width: 1, height: 1 },
  );
  assert.equal(pixels.outputWidth, 1080);
  assert.equal(pixels.outputHeight % 2, 0);
});

function browserHarness(scenario = "success") {
  let executed = 0,
    disposed = 0,
    options;
  const video = {},
    audio = {};
  const controller = new AbortController();
  class Input {
    async getPrimaryVideoTrack() {
      return {
        ...video,
        getDisplayWidth: async () => 800,
        getDisplayHeight: async () => 600,
      };
    }
    async getPrimaryAudioTrack() {
      return audio;
    }
    async computeDuration() {
      return 5;
    }
    dispose() {
      disposed++;
    }
  }
  let actualVideo;
  Input.prototype.getPrimaryVideoTrack = async function () {
    return (actualVideo ??= {
      getDisplayWidth: async () => 800,
      getDisplayHeight: async () => 600,
    });
  };
  class BufferTarget {
    on(_event, callback) {
      this.write = callback;
    }
  }
  class Quality {
    constructor(value) {
      assert.equal(typeof value, "object");
      assert.ok(value.bitrate > 0);
    }
  }
  const media = {
    Input,
    BlobSource: class {},
    ALL_FORMATS: [],
    BufferTarget,
    Quality,
    Mp4OutputFormat: class {},
    WebMOutputFormat: class {},
    Output: class {
      constructor(value) {
        Object.assign(this, value);
      }
    },
    canEncodeVideo: async () => scenario !== "unsupported",
    canEncodeAudio: async () => true,
    Conversion: {
      init: async (value) => {
        options = value;
        const conversion = {
          isValid: true,
          utilizedTracks:
            scenario === "audio-dropped" ? [actualVideo] : [actualVideo, audio],
          state: "idle",
          async cancel() {
            this.state = "canceled";
          },
          async execute() {
            executed++;
            this.state = "executing";
            if (scenario === "abort") {
              controller.abort();
              await Promise.resolve();
              throw Error("cancelled");
            }
            value.output.target.write({
              end: scenario === "oversize" ? 10001 : 1000,
            });
            value.output.target.buffer = new ArrayBuffer(1000);
            this.state = "done";
            this.onProgress?.(1);
          },
        };
        return conversion;
      },
    },
  };
  const api = loader({ mediabunny: media })("src/lib/media/browser-video-editor.ts");
  return { api, controller, inspect: () => ({ executed, disposed, options }) };
}

for (const scenario of [
  "success",
  "audio-dropped",
  "unsupported",
  "oversize",
  "abort",
])
  test(`browser export enforces media integrity: ${scenario}`, async () => {
    const h = browserHarness(scenario);
    const file = new File([new Uint8Array(3000)], "source.mov", {
      type: "video/quicktime",
    });
    const run = () =>
      h.api.exportEditedVideo(file, edit, {
        maxBytes: 10000,
        signal: h.controller.signal,
        onProgress: () => {},
      });
    if (scenario === "success") {
      const result = await run();
      assert.equal(result.type, "video/mp4");
      assert.equal(result.name, "source-edited.mp4");
      assert.equal(result.size, 1000);
      assert.equal(h.inspect().options.trim.start, 1);
      assert.equal(h.inspect().options.trim.end, 3);
      assert.equal(h.inspect().options.video.crop.width, 400);
      assert.equal(h.inspect().options.audio.codec, "aac");
    } else await assert.rejects(run);
    assert.equal(h.inspect().disposed, 1);
    assert.equal(
      h.inspect().executed,
      ["audio-dropped", "unsupported"].includes(scenario) ? 0 : 1,
    );
  });

test("an already-aborted browser edit performs no media reads", async () => {
  const h = browserHarness();
  h.controller.abort();
  await assert.rejects(() =>
    h.api.exportEditedVideo(new File(["x"], "v.mp4"), edit, {
      maxBytes: 10000,
      signal: h.controller.signal,
      onProgress: () => {},
    }),
  );
  assert.equal(h.inspect().disposed, 0);
  assert.equal(h.inspect().executed, 0);
});
