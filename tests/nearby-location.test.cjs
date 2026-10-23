const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const moduleObject = { exports: {} };
new Function(
  "module",
  "exports",
  ts.transpileModule(fs.readFileSync("src/lib/people/nearby-location.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
)(moduleObject, moduleObject.exports);

const { resolveNearbyLocation } = moduleObject.exports;

test("Nearby stays in the signed-in user's LGA when the global filter is all Nigeria", () => {
  assert.deepEqual(
    resolveNearbyLocation(null, { home_state: "Lagos", home_lga: "Ikeja" }),
    { state: "Lagos", lga: "Ikeja" },
  );
});

test("Nearby does not widen to a whole state when the selected state has no LGA", () => {
  assert.equal(
    resolveNearbyLocation({ state: "Oyo" }, { home_state: "Lagos", home_lga: "Ikeja" }),
    null,
  );
});

test("Nearby does not show a national directory when profile location is missing", () => {
  assert.equal(resolveNearbyLocation(null, null), null);
});

test("Nearby queries always require both home-state and home-LGA filters", () => {
  const service = fs.readFileSync("src/lib/people/nearby.ts", "utf8");
  assert.match(service, /if \(!location\?\.state \|\| !location\.lga\) return \[\]/);
  assert.match(service, /eq\("home_state", location\.state\)\.eq\("home_lga", location\.lga\)/);
});
