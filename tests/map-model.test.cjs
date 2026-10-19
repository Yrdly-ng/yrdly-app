const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(path, imports = {}) {
  const result = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', code)(result.exports, name => imports[name]);
  return result.exports;
}
const card = load('src/lib/marketplace/card-display.ts');
const model = load('src/lib/location/map-model.ts', { '../marketplace/card-display': card });
const listing = { id: 'item', title: 'Chair', lat: 6.5, lng: 3.4, price: null, image_urls: '{bad' };

test('coordinates reject missing, blank and out-of-range values but retain zero and numeric legacy strings', () => {
  for (const pair of [[null, null], ['', 3], [true, 3], [91, 3], [6, -181], [NaN, 3], [Infinity, 3]]) assert.equal(model.coordinates(...pair), null);
  assert.deepEqual(model.coordinates('0', '-0.5'), { lat: 0, lng: -0.5 });
});
test('normalization preserves legacy geopoints, safe media, null/zero prices, and privacy jitter bounds', () => {
  const marker = model.normalizeMarker(listing, 'marketplace', 'marketplace');
  assert.equal(marker.subtitle, 'Price unavailable');
  assert.equal(marker.image, undefined);
  assert.equal(model.normalizeMarker({ ...listing, price: 0 }, 'marketplace', 'm').subtitle, 'Free');
  const legacy = model.normalizeMarker({ id: 'old', event_location: { geopoint: { latitude: '6.5', longitude: '3.4' } } }, 'event', 'legacy');
  assert.equal(legacy.lat, 6.5);
  assert.equal(legacy.lng, 3.4);
  assert.equal(model.normalizeMarker({ id: 'friend', lat: 6.5, lng: 3.4 }, 'friend', 'f'), null);
  const friend = model.normalizeMarker({ id: 'friend', current_location: { lat: 6.5, lng: 3.4 } }, 'friend', 'f', true);
  assert.ok(Math.abs(friend.lat - 6.5) <= .001);
  assert.ok(Math.abs(friend.lng - 3.4) <= .001);
  assert.equal(friend.subtitle, 'Approximate shared location');
});
test('rejected, timed-out and malformed sources retain independent successful results', async () => {
  const source = (key, load) => ({ key, label: key, kind: 'marketplace', load });
  const result = await model.loadMapSources([
    source('good', async () => ({ data: [listing, null, { id: 'invalid', lat: 200, lng: 4 }] })),
    source('throw', () => { throw Error('Denied'); }),
    source('slow', () => new Promise(() => {})),
    source('bad', async () => ({ data: {} })),
    source('error', async () => ({ data: [], error: Error('Unavailable') })),
  ], false, 20);
  assert.equal(result.markers.length, 1);
  assert.deepEqual(result.failedSources, ['throw', 'slow', 'bad', 'error']);
});
test('filters reconcile visible selection and routes preserve existing destinations', () => {
  const a = model.normalizeMarker(listing, 'marketplace', 'm');
  const b = model.normalizeMarker({ ...listing, id: 'event', title: 'Music night' }, 'event', 'e');
  assert.deepEqual(model.filterMarkers([a,b], 'all', ' MUSIC '), [b]);
  assert.deepEqual(model.filterMarkers([a,b], 'friend', ''), []);
  assert.equal(model.markerRoute(a), '/marketplace/item');
  assert.equal(model.markerRoute(b), '/events/event');
});
test('ETA rejects malformed data and falls back to regular duration when traffic is absent', () => {
  for (const bad of [null, {}, { duration_seconds: -1, distance_meters: 3 }, { duration_seconds: 5, distance_meters: NaN }]) assert.equal(model.normalizeEta(bad), null);
  assert.equal(model.normalizeEta({ duration_seconds: 100, distance_meters: 800 }).duration_in_traffic_seconds, 100);
});
test('query filters keep legacy locations while excluding empty primary coordinates before row limits', async () => {
  const { createClient } = require('@supabase/supabase-js');
  let requested;
  const client = createClient('https://map-fixture.supabase.co', 'test-anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async url => { requested = new URL(url); return new Response('[]', { headers: { 'content-type': 'application/json' } }); } },
  });
  const response = await client.from('posts').select('id').eq('category', 'For Sale').or('is_sold.eq.false,is_sold.is.null').or(model.mappableRowsFilter('event_location')).limit(30);
  assert.equal(response.error, null);
  assert.equal(requested.searchParams.getAll('or').length, 2);
  assert.match(requested.searchParams.getAll('or')[1], /event_location->geopoint->>latitude/);
  assert.equal(requested.searchParams.get('limit'), '30');
});
