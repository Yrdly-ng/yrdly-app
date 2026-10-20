const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
function load(file, imports = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("module", "exports", "require", code)(
    module,
    module.exports,
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`);
      return imports[name];
    },
  );
  return module.exports;
}
const card = load("src/lib/marketplace/card-display.ts");
const model = load("src/lib/location/map-model.ts", {
  "../marketplace/card-display": card,
});
const good = {
  id: "good",
  title: "Existing pin",
  lat: 6.5,
  lng: 3.4,
  state: "Lagos",
  lga: "Ikeja",
};
function resolver(geocode, queryRows = [], timeoutMs) {
  const queries = [];
  const supabase = {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          queries.push([key, value]);
          return query;
        },
        order() {
          return query;
        },
        limit: async () => ({ data: queryRows, error: null }),
      };
      assert.equal(table, "lga_wards");
      return query;
    },
  };
  return {
    queries,
    resolve: load("src/lib/location/map-location.ts", {
      "./map-model": model,
      "../supabase/supabase": { supabase },
    }).createMapLocationResolver(geocode, timeoutMs),
  };
}
const geocoded = {
  status: "OK",
  results: [
    {
      geometry: { location: { lat: 7.1, lng: 4.7 }, location_type: "ROOFTOP" },
      address_components: [
        { long_name: "Lagos", types: ["administrative_area_level_1"] },
        { long_name: "Ikeja", types: ["administrative_area_level_2"] },
      ],
    },
  ],
};

test("location resolution cannot leave the map loading forever or discard completed pins", async () => {
  const slow = {
    id: "slow",
    title: "Address-only pin",
    location: "Fixture address",
  };
  const source = {
    key: "business",
    label: "Businesses",
    kind: "business",
    load: async () => ({ data: [good, slow] }),
  };
  let timer;
  const result = await Promise.race([
    model.loadMapSources([source], false, 20, () => new Promise(() => {})),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve("hung"), 180);
    }),
  ]);
  clearTimeout(timer);
  assert.notEqual(result, "hung", "geocoding must obey the source timeout too");
  assert.deepEqual(
    result.markers.map((m) => m.targetId),
    ["good"],
  );
  assert.deepEqual(result.failedSources, []);
  assert.deepEqual(result.unresolvedSources, ["Businesses"]);
});

test("invalid or incomplete primary coordinates fall back to a complete legacy coordinate pair", () => {
  for (const top of [
    { lat: 999, lng: 999 },
    { lat: 6.2, lng: null },
    { lat: "", lng: 3.2 },
  ]) {
    const pin = model.normalizeMarker(
      { ...good, ...top, location: { latitude: 8.1, longitude: 4.7 } },
      "business",
      "business",
    );
    assert.ok(pin, "valid legacy coordinates retain the pin");
    assert.deepEqual(
      { lat: pin.lat, lng: pin.lng },
      { lat: 8.1, lng: 4.7 },
      "coordinate pairs cannot be mixed between locations",
    );
  }
});

test("address lookup enriches missing area without moving an existing precise pin", async () => {
  let lookups = 0;
  const { resolve } = resolver(async () => {
    lookups++;
    return geocoded;
  });
  const row = {
    id: "legacy",
    title: "Legacy venue",
    lat: 6.5,
    lng: 3.4,
    location: { address: "Fixture public venue" },
  };
  const result = await model.loadMapSources(
    [
      {
        key: "b",
        label: "Businesses",
        kind: "business",
        load: async () => ({ data: [row] }),
      },
    ],
    false,
    100,
    resolve,
  );
  assert.equal(result.markers.length, 1);
  const pin = result.markers[0];
  assert.deepEqual({ lat: pin.lat, lng: pin.lng }, { lat: 6.5, lng: 3.4 });
  assert.ok(
    model.matchesMapArea(pin, { state: "Lagos", lga: "Ikeja" }),
    "legacy venue must survive the selected area filter",
  );
  assert.equal(lookups, 1);
});

test("address-only public content resolves once and friend locations never go to geocoding", async () => {
  let calls = 0;
  const { resolve } = resolver(async () => {
    calls++;
    return geocoded;
  });
  const row = { id: "address-only", location: "Fixture public venue" };
  const [a, b] = await Promise.all([
    resolve(row, "business"),
    resolve({ ...row, id: "second" }, "business"),
  ]);
  assert.deepEqual({ lat: a.lat, lng: a.lng }, { lat: 7.1, lng: 4.7 });
  assert.equal(b.map_state, "Lagos");
  assert.equal(calls, 1);
  const friend = {
    id: "friend",
    current_location: { lat: 6.5, lng: 3.4 },
    location: "Private home",
  };
  assert.equal(await resolve(friend, "friend"), friend);
  assert.equal(calls, 1);
});

test("failed address service retains a labelled approximate public area", async () => {
  const { resolve } = resolver(async () => {
    throw Error("offline");
  }, [
    { latitude: 6.4, longitude: 3.2 },
    { latitude: 6.6, longitude: 3.4 },
  ]);
  const resolved = await resolve(
    { id: "area", location: "Fixture venue", state: "Lagos", lga: "Ikeja" },
    "business",
  );
  const pin = model.normalizeMarker(resolved, "business", "business");
  assert.ok(pin.subtitle.includes("Approximate area"));
  assert.ok(Math.abs(pin.lat - 6.5) < 1e-8);
  assert.ok(Math.abs(pin.lng - 3.3) < 1e-8);
  assert.ok(
    model.matchesMapArea(pin, { state: "Lagos State", lga: "Ikeja LGA" }),
  );
  assert.equal(
    model.matchesMapArea(pin, { state: "Oyo", lga: "Ikeja" }),
    false,
  );
});

test("cancelling an old map load settles promptly and aborts its location lookups", async () => {
  const controller = new AbortController();
  const signals = [];
  const source = {
    key: "b",
    label: "Businesses",
    kind: "business",
    load: async () => ({
      data: [good, { id: "pending", location: "Fixture venue" }],
    }),
  };
  const pending = model.loadMapSources(
    [source],
    false,
    200,
    (_row, _kind, signal) => {
      signals.push(signal);
      return new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new Error("Aborted")), {
          once: true,
        }),
      );
    },
    controller.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  let timer;
  const result = await Promise.race([
    pending,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve("hung"), 150);
    }),
  ]);
  clearTimeout(timer);
  assert.notEqual(result, "hung", "aborted account/area loads must finish");
  assert.deepEqual(
    result.markers.map((pin) => pin.targetId),
    ["good"],
  );
  assert.ok(signals.length > 0);
  assert.ok(signals.every((signal) => signal?.aborted));
});

test("aborted address lookup clears pending cache so a later retry can succeed", async () => {
  let calls = 0;
  const { resolve } = resolver(async () => {
    calls++;
    return calls === 1 ? new Promise(() => {}) : geocoded;
  });
  const controller = new AbortController();
  const row = { id: "retry", location: "Fixture retry address" };
  const pending = resolve(row, "business", controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  let timer;
  const settled = await Promise.race([
    pending.then(
      () => true,
      () => true,
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), 150);
    }),
  ]);
  clearTimeout(timer);
  assert.equal(settled, true, "aborting lookup must release pending work");
  const retried = await resolve(row, "business");
  assert.equal(calls, 2);
  assert.equal(retried.lat, 7.1);
});

test("a hung address service releases its cache entry and a retry can recover", async () => {
  let calls = 0;
  const { resolve } = resolver(
    async () => {
      calls++;
      return calls === 1 ? new Promise(() => {}) : geocoded;
    },
    [],
    15,
  );
  const row = { id: "timed-out", location: "Fixture timeout venue" };
  await assert.rejects(resolve(row, "business"));
  const retried = await resolve(row, "business");
  assert.equal(calls, 2);
  assert.equal(retried.lat, 7.1);
});

test("optional address enrichment cannot report loaded Events as failed", async () => {
  const row = {
    id: "event",
    title: "Event",
    lat: 6.5,
    lng: 3.4,
    location_address: "Venue",
  };
  const result = await model.loadMapSources(
    [
      {
        key: "events",
        label: "Events",
        kind: "event",
        load: async () => ({ data: [row] }),
      },
    ],
    false,
    30,
    async () => {
      throw Error("Geocoding unavailable");
    },
  );
  assert.equal(result.markers.length, 1);
  assert.deepEqual(result.failedSources, []);
  assert.deepEqual(result.unresolvedSources, []);
});

test("loaded rows without positions report unavailable locations rather than a failed data source", async () => {
  const result = await model.loadMapSources(
    [
      {
        key: "events",
        label: "Events",
        kind: "event",
        load: async () => ({
          data: [{ id: "event", location_address: "Venue" }],
        }),
      },
    ],
    false,
    30,
    async () => {
      throw Error("Geocoding unavailable");
    },
  );
  assert.deepEqual(result.failedSources, []);
  assert.deepEqual(result.unresolvedSources, ["Events"]);
});

test("a geocoder match in another state cannot move a Lagos venue to Kano", async () => {
  const wrong = {
    status: "OK",
    results: [
      {
        types: ["street_address"],
        geometry: { location: { lat: 12, lng: 8.5 }, location_type: "ROOFTOP" },
        address_components: [
          { long_name: "Kano", types: ["administrative_area_level_1"] },
        ],
      },
    ],
  };
  const { resolve } = resolver(
    async () => wrong,
    [{ latitude: 6.5, longitude: 3.4 }],
  );
  const row = await resolve(
    { id: "venue", location: "Ambiguous venue", state: "Lagos", lga: "Ikeja" },
    "business",
  );
  assert.equal(row.lat, 6.5);
  assert.equal(row.lng, 3.4);
  assert.equal(row.map_approximate, true);
});

test("a country-only geocoder match is not a venue location", async () => {
  const { resolve } = resolver(async () => ({
    status: "OK",
    results: [
      { types: ["country"], geometry: { location: { lat: 9, lng: 8 } } },
    ],
  }));
  const row = await resolve({ id: "venue", location: "Nigeria" }, "business");
  assert.equal(model.normalizeMarker(row, "business", "business"), null);
});

test("retry after an empty geocoder match can recover without remounting the map", async () => {
  let calls = 0;
  const { resolve } = resolver(async () =>
    ++calls === 1 ? { status: "ZERO_RESULTS", results: [] } : geocoded,
  );
  const row = { id: "venue", location: "Venue corrected after retry" };
  assert.equal(
    model.mapCoordinates(await resolve(row, "business"), "business"),
    null,
  );
  assert.equal((await resolve(row, "business")).lat, 7.1);
  assert.equal(calls, 2);
});
