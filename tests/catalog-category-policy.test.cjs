const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file) {
  const module = { exports: {} };
  Function('module', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText)(module, module.exports);
  return module.exports;
}
const { getCatalogCategories, MAX_CATALOG_IMAGES } = load('src/lib/businesses/catalog-categories.ts');
const { supportsPostEngagement } = load('src/lib/posts/post-engagement.ts');

test('legacy and current business sectors receive appropriate catalog categories', () => {
  for (const category of ['Tech', 'Tech & Repair', 'Tech and Repairs']) {
    const options = getCatalogCategories(category);
    for (const item of ['Laptops', 'Mobile Phones', 'Desktops', 'Repairs']) assert.ok(options.includes(item));
    assert.ok(!options.includes('Baked Goods'));
  }
  for (const category of ['Food & Drinks', 'Restaurant & Café', 'Food & Catering']) {
    assert.ok(getCatalogCategories(category).includes('Meals'));
  }
  assert.ok(getCatalogCategories('Beauty & Salon').includes('Hair Care'));
  assert.ok(getCatalogCategories('Gyms & Fitness').includes('Fitness Equipment'));
  assert.ok(getCatalogCategories('Fashion').includes('Clothing'));
  assert.ok(getCatalogCategories('Retail').length > 10);
  assert.ok(getCatalogCategories(null).includes('Other'));
  assert.equal(MAX_CATALOG_IMAGES, 4);
});

test('editing retains legacy categories without altering the next business options', () => {
  const options = getCatalogCategories('Tech & Repair', 'Custom legacy label');
  assert.ok(options.includes('Custom legacy label'));
  assert.equal(new Set(options).size, options.length);
  assert.ok(!getCatalogCategories('Tech & Repair').includes('Custom legacy label'));
});

test('commercial and event posts reject engagement while ordinary conversations retain it', () => {
  for (const category of ['Business', ' business ', 'Marketplace', 'For Sale', 'Selling', 'Giveaway', 'Event']) {
    assert.equal(supportsPostEngagement(category), false, category);
  }
  for (const category of ['General', 'Question', 'Alert', undefined, null]) {
    assert.equal(supportsPostEngagement(category), true, String(category));
  }
});
