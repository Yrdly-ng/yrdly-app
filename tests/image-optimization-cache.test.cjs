const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('image optimizer caches stable images for 31 days', () => {
  const config = readFileSync('next.config.mjs', 'utf8');
  assert.match(config, /minimumCacheTTL:\s*60\s*\*\s*60\s*\*\s*24\s*\*\s*31/);
  assert.match(config, /unoptimized:\s*false/);
});

test('discover avatars declare their 80px render size', () => {
  const component = readFileSync('src/components/people/DiscoverUserCard.tsx', 'utf8');
  assert.match(component, /sizes="80px"/);
});
