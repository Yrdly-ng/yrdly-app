const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('public business search uses a minimal approved projection', () => {
  const source = fs.readFileSync('src/components/search/SearchDialog.tsx', 'utf8');
  assert.match(source, /\.from\('businesses'\)[\s\S]{0,250}\.select\('id, name, image_urls, rating, review_count'\)/);
  assert.match(source, /\.eq\('moderation_status', 'approved'\)/);
  assert.match(source, /\.eq\('is_flagged', false\)/);
  assert.doesNotMatch(source, /\.select\('\*'\)/);
});
