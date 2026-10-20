const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function loadClient() {
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync("src/lib/location/directions-client.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

test("detail actions and legacy pins open the same internal directions flow", () => {
  const client = loadClient();
  for (const type of ["marketplace", "event", "business", "legacy-event"]) {
    const target = { type, id: "fixture-id" };
    const href = client.buildDirectionsHref(target);
    assert.equal(href, `/map?destinationType=${type}&destinationId=fixture-id`);
    assert.deepEqual(
      client.readDirectionsTarget(new URLSearchParams(href.split("?")[1])),
      target,
    );
  }
  assert.deepEqual(
    client.directionsTargetForMarker({
      type: "event",
      id: "legacy-event-old",
      targetId: "old",
    }),
    { type: "legacy-event", id: "old" },
  );
  assert.equal(
    client.directionsTargetForMarker({ type: "friend", targetId: "private" }),
    null,
  );
  assert.equal(
    client.readDirectionsTarget(
      new URLSearchParams("destinationType=friend&destinationId=private"),
    ),
    null,
  );
  assert.equal(
    client.readDirectionsTarget(
      new URLSearchParams(
        "destinationType=event&destinationId=a&destinationId=b",
      ),
    ),
    null,
  );
});

test("changing mode or leaving directions cannot draw an older route", async () => {
  const { createDirectionsSession } = loadClient();
  const pending = [];
  const session = createDirectionsSession(
    (path, body, signal) =>
      new Promise((resolve) => pending.push({ path, body, signal, resolve })),
  );
  const target = { type: "business", id: "shop" };
  const first = session.route(target, { lat: 6.5, lng: 3.4 }, "driving");
  const second = session.route(target, { lat: 6.5, lng: 3.4 }, "walking");
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ mode: "walking" });
  assert.deepEqual(await second, { mode: "walking" });
  pending[0].resolve({ mode: "driving" });
  assert.equal(await first, null);
  const third = session.route(target, { lat: 6.5, lng: 3.4 }, "driving");
  session.cancel();
  assert.equal(pending[2].signal.aborted, true);
  pending[2].resolve({ mode: "driving" });
  assert.equal(await third, null);
  assert.equal(pending[1].path, "/api/directions/route");
  assert.deepEqual(pending[1].body, {
    destination: target,
    origin: { lat: 6.5, lng: 3.4 },
    mode: "walking",
  });
});

test("route geometry decodes real provider coordinates and rejects incomplete or invalid paths", () => {
  const { decodeRoutePolyline } = loadClient();
  assert.deepEqual(decodeRoutePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]);
  for (const value of ["", "~~~~", "!", "????x", null])
    assert.deepEqual(decodeRoutePolyline(value), []);
});
