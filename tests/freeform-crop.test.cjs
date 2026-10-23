const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><body></body>");
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const moduleObject = { exports: {} };
new Function(
  "require",
  "module",
  "exports",
  ts.transpileModule(
    fs.readFileSync("src/components/media/CropSelection.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
)(require, moduleObject, moduleObject.exports);
async function fixture() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let crop = { x: 0, y: 0, width: 1, height: 1 };
  function Probe() {
    const [value, setValue] = React.useState(crop);
    crop = value;
    return React.createElement(
      moduleObject.exports.CropSelection,
      { crop: value, onChange: setValue, sourceAspect: 2, aspect: null },
      React.createElement("img", { alt: "Fixture" }),
    );
  }
  await act(async () => root.render(React.createElement(Probe)));
  const frame = host.firstChild;
  frame.getBoundingClientRect = () => ({
    width: 400,
    height: 200,
    left: 0,
    top: 0,
  });
  frame.setPointerCapture = () => {};
  const pointer = async (node, type, x, y, id = 1) => {
    const event = new window.Event(type, { bubbles: true });
    Object.assign(event, { clientX: x, clientY: y, pointerId: id });
    await act(async () => node.dispatchEvent(event));
  };
  return {
    host,
    frame,
    pointer,
    get crop() {
      return crop;
    },
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
test("shared image/video freeform frame resizes axes independently and repositions within bounds", async () => {
  const app = await fixture();
  try {
    await app.pointer(
      app.host.querySelector('[data-crop-handle="se"]'),
      "pointerdown",
      400,
      200,
    );
    await app.pointer(app.frame, "pointermove", 300, 160);
    assert.deepEqual(app.crop, { x: 0, y: 0, width: 0.75, height: 0.8 });
    await app.pointer(app.frame, "pointerup", 300, 160);
    await app.pointer(
      app.host.querySelector('[data-crop-handle="w"]'),
      "pointerdown",
      0,
      80,
    );
    await app.pointer(app.frame, "pointermove", 40, 80);
    assert.equal(app.crop.x, 0.1);
    assert.equal(app.crop.width, 0.65);
    assert.equal(app.crop.height, 0.8);
    await app.pointer(app.frame, "pointerup", 40, 80);
    await app.pointer(app.frame, "pointerdown", 100, 100);
    await app.pointer(app.frame, "pointermove", 1000, 1000);
    assert.equal(app.crop.x, 0.35);
    assert.ok(Math.abs(app.crop.y - 0.2) < 1e-9);
    assert.equal(app.crop.width, 0.65);
    assert.equal(app.crop.height, 0.8);
  } finally {
    await app.close();
  }
});
test("freeform corner keyboard controls change just the requested boundary", async () => {
  const app = await fixture();
  try {
    const handle = app.host.querySelector('[data-crop-handle="se"]');
    await act(async () =>
      handle.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }),
      ),
    );
    assert.equal(app.crop.width, 0.99);
    assert.equal(app.crop.height, 1);
    await act(async () =>
      handle.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      ),
    );
    assert.equal(app.crop.width, 0.99);
    assert.equal(app.crop.height, 0.99);
  } finally {
    await app.close();
  }
});
