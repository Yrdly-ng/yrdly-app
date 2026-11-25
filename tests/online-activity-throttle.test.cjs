const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('online activity tracking throttles duplicate writes and uses a two-minute heartbeat', () => {
  const source = fs.readFileSync('src/hooks/use-activity-tracking.ts', 'utf8');
  assert.match(source, /now - previous\.at < 15000/);
  assert.match(source, /\}, 120000\)/);
  assert.match(source, /if \(error\) throw error/);
});
