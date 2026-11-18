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


const { CATEGORY_ICON_GROUPS, getCategoryIconKey, normalizeCategoryLabel } =
  load('src/lib/discovery/category-icon-map.ts');

test('known category labels resolve to consistent outline icon meanings', () => {
  const keys = Object.keys(CATEGORY_ICON_GROUPS);
  assert.ok(keys.length >= 35);
  const normalizedLabels = new Map();
  for (const key of keys) {
    for (const label of CATEGORY_ICON_GROUPS[key]) {
      const normalized = normalizeCategoryLabel(label);
      const previous = normalizedLabels.get(normalized);
      assert.ok(!previous || previous === key, label + ' must have one meaning');
      normalizedLabels.set(normalized, key);
      assert.equal(getCategoryIconKey(label), key, label);
    }
  }
  assert.ok(normalizedLabels.size >= 140);
  for (const [label, expected] of [
    ['Electronics', 'electronics'],
    ['Home & Living', 'home'],
    ['Fashion', 'fashion'],
    ['Music', 'music'],
    ['Food & Drink', 'food'],
    ['Arts & Culture', 'arts'],
    ['Beauty & Salon', 'beauty'],
    ['Health & Beauty', 'beauty'],
    ['Laundry', 'laundry'],
    ['Tailoring', 'tailoring'],
    ['Unknown custom category', 'other'],
    ['', 'other'],
  ]) assert.equal(getCategoryIconKey(label), expected, label);
  assert.equal(getCategoryIconKey('Restaurant & Cafe'), 'food', 'accent-insensitive');
  assert.equal(getCategoryIconKey('CUSTOM CLOTHING & SEWING'), 'tailoring');
});

test('every existing business catalog category has a designated icon', () => {
  const source = fs.readFileSync('src/lib/businesses/catalog-categories.ts', 'utf8');
  const catalog = source.slice(source.indexOf('const CATALOG_CATEGORIES'), source.indexOf('function catalogSector'));
  const labels = [...new Set([...catalog.matchAll(/'([^']+)'|"([^"]+)"/g)].map(match => match[1] || match[2]))];
  const known = new Set(
    Object.values(CATEGORY_ICON_GROUPS).flat().map(normalizeCategoryLabel),
  );
  assert.ok(labels.length > 70);
  assert.deepEqual(
    labels.filter(label => !known.has(normalizeCategoryLabel(label))),
    [],
    'Category icon mapping must be updated when catalog categories change',
  );
});


test('web discovery category icons cover Marketplace, Businessplace and Events', () => {
  const marketplace = fs.readFileSync('src/components/marketplace/MarketplaceScreen.tsx', 'utf8');
  const businesses = fs.readFileSync('src/components/businesses/BusinessesScreen.tsx', 'utf8');
  const businessHub = fs.readFileSync('src/components/businesses/BusinessHub.tsx', 'utf8');
  const events = fs.readFileSync('src/components/events/EventsScreen.tsx', 'utf8');
  const renderer = fs.readFileSync('src/components/discovery/CategoryIcon.tsx', 'utf8');
  assert.match(marketplace, /CategoryIcon\s+category=\{category\.label\}/);
  assert.match(businesses, /CategoryIcon category=\{item\}/);
  assert.match(businesses, /CategoryIcon category=\{business\.category\}/);
  assert.match(businessHub, /CategoryIcon category=\{cat\}/);
  assert.match(events, /CategoryIcon category=\{item\}/);
  assert.match(renderer, /WEB_CATEGORY_ICONS: Record<CategoryIconKey, LucideIcon>/);
});

test('web event category icons are backed by actual published event categories', () => {
  const events = fs.readFileSync('src/components/events/EventsScreen.tsx', 'utf8');
  assert.match(events, /actualEventCategories/);
  assert.match(events, /events\.map\(\(event\) => event\.category\?\.trim\(\)\)/);
  assert.match(events, /CategoryIcon category=\{category\}/);
  assert.match(events, /setEventCategory\(category\)/);
});

test('web shoppable collage is used only for multi-photo For Sale posts', () => {
  const card = fs.readFileSync('src/components/posts/PostCard.tsx', 'utf8');
  const collage = fs.readFileSync('src/components/posts/ShoppablePhotoCollage.tsx', 'utf8');
  assert.match(card, /post\.category === "For Sale" && urls\.length >= 2 && videoUrls\.length === 0/);
  assert.match(card, /!showShoppablePhotoCollage && mediaItems\.length > 0/);
  assert.match(card, /<ShoppablePhotoCollage/);
  assert.match(card, /onOpen=\{handleImageClick\}/);
  assert.match(collage, /images\.slice\(0, 3\)/);
  assert.match(collage, /Math\.max\(0, images\.length - 3\)/);
  assert.match(collage, /aria-label=\{`View photo/);
  assert.doesNotMatch(collage, /From ₦3,500/);
});
