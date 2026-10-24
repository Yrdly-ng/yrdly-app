const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const screen = fs.readFileSync("src/components/communities/CommunityScreen.tsx", "utf8");
const homepage = fs.readFileSync("src/components/people/DiscoverPeopleSection.tsx", "utf8");
const hook = fs.readFileSync("src/hooks/use-community-connections.ts", "utf8");
const service = fs.readFileSync("src/lib/people/nearby.ts", "utf8");

test("Nearby requires explicit consent and foreground browser location", () => {
  assert.match(screen, /Find people near you/);
  assert.match(screen, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(screen, /nearby_enabled/);
  assert.match(screen, /exact coordinates/i);
});

test("Nearby filters use a bounded radius on both web discovery surfaces", () => {
  assert.match(screen, /\[5000, 10000, 25000\]/);
  assert.match(service, /p_radius_meters: radiusMeters/);
  assert.match(homepage, /findNearbyPeople/);
  assert.match(hook, /p_radius_meters: radiusMeters/);
});

test("web Nearby does not use a public-profile directory as a fallback", () => {
  assert.doesNotMatch(hook, /from\(['"]public_profiles['"]\)/);
  assert.match(hook, /rpc\(['"]nearby_people['"],/);
});
