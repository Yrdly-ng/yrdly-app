const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const moduleObject = { exports: {} };
new Function(
  "module",
  "exports",
  ts.transpileModule(fs.readFileSync("src/lib/people/nearby.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
)(moduleObject, moduleObject.exports);

const { loadNearbyPeople } = moduleObject.exports;

test("Nearby calls the radius RPC and only maps approximate distance bands", async () => {
  let rpcName;
  let rpcArgs;
  const client = {
    rpc(name, args) {
      rpcName = name;
      rpcArgs = args;
      return {
        abortSignal: async () => ({
          data: [{ id: "nearby-user", name: "Ayo", distance_band: "Within 5 km" }],
          error: null,
        }),
      };
    },
  };
  const people = await loadNearbyPeople(client, {
    coordinates: { latitude: 6.5, longitude: 3.4 },
    radiusMeters: 5000,
    filter: "all",
    signal: new AbortController().signal,
  });

  assert.equal(rpcName, "nearby_people");
  assert.equal(rpcArgs.p_radius_meters, 5000);
  assert.equal(rpcArgs.p_latitude, 6.5);
  assert.equal(rpcArgs.p_longitude, 3.4);
  assert.equal(people[0].distance_band, "Within 5 km");
  assert.equal("latitude" in people[0], false);
  assert.equal("longitude" in people[0], false);
});

test("Nearby presence is private, short-lived, opt-in, and filtered with an indexed distance query", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20261023202417_nearby_location_presence.sql",
    "utf8",
  );
  assert.match(migration, /create schema if not exists private/);
  assert.match(migration, /create table if not exists private\.nearby_presence/);
  assert.match(migration, /interval '30 minutes'/);
  assert.match(migration, /extensions\.st_dwithin\(np\.location, v_origin, p_radius_meters\)/i);
  assert.match(migration, /u\.nearby_enabled is true/);
  assert.match(migration, /revoke all on private\.nearby_presence from public, anon, authenticated/i);
  assert.match(migration, /distance_band text/i);
});
