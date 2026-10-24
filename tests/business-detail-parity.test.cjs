const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const moduleObject = { exports: {} };
new Function(
  "module",
  "exports",
  ts.transpileModule(
    fs.readFileSync("src/lib/businesses/presentation.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
)(moduleObject, moduleObject.exports);

const {
  getBusinessCatalogItems,
  isCatalogItemAvailable,
  getBusinessLogo,
  getCatalogItemImage,
  shouldShowBusinessCatalog,
} = moduleObject.exports;

test("catalog availability agrees with checkout inventory precedence", () => {
  for (const [item, expected] of [
    [{ in_stock: true, quantity: null }, true],
    [{ in_stock: true, quantity: 0, inventory_count: 5 }, false],
    [{ in_stock: true, quantity: null, inventory_count: 0 }, false],
    [{ in_stock: true, quantity: 2 }, true],
    [{ in_stock: false, quantity: 2 }, false],
  ]) assert.equal(isCatalogItemAvailable(item), expected);
});

test("business type controls whether its product catalog is shown", () => {
  assert.equal(shouldShowBusinessCatalog("service", 0), false);
  assert.equal(shouldShowBusinessCatalog("service", 2), false);
  assert.equal(shouldShowBusinessCatalog("service", 2, true), false);
  assert.equal(shouldShowBusinessCatalog("both", 0), true);
  assert.equal(shouldShowBusinessCatalog("product", 0), true);
});

test("database guards prevent service-only businesses from gaining product items", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20261023190000_enforce_business_catalog_type.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TRIGGER enforce_catalog_business_type/);
  assert.match(migration, /selected_business_type = 'service'/);
  assert.match(migration, /CREATE TRIGGER prevent_service_type_with_catalog/);
});

test("catalog visibility keeps sold-out items discoverable and owner filtering uses availability", () => {
  const rows = [
    { id: "in-stock-no-count", in_stock: true, quantity: null },
    { id: "in-stock-zero-count", in_stock: true, quantity: 0 },
    { id: "sold-out", in_stock: false, quantity: 0 },
  ];

  assert.deepEqual(
    getBusinessCatalogItems(rows, false, false).map((item) => item.id),
    ["in-stock-no-count", "in-stock-zero-count", "sold-out"],
  );
  assert.deepEqual(
    getBusinessCatalogItems(rows, true, false).map((item) => item.id),
    ["in-stock-no-count"],
  );
  assert.deepEqual(getBusinessCatalogItems(rows, true, true), rows);
});

test("business logo never falls back to its banner", () => {
  assert.equal(
    getBusinessLogo({ logo: "legacy-logo.png", logo_url: "business-logo.png" }),
    "business-logo.png",
  );
  assert.equal(
    getBusinessLogo({ logo: null, logo_url: null, cover_image: "banner.png" }),
    null,
  );
});

test("catalog rows without an image still render a safe placeholder", () => {
  assert.equal(getCatalogItemImage(null), "/placeholder.svg");
  assert.equal(getCatalogItemImage([]), "/placeholder.svg");
  assert.equal(getCatalogItemImage(["", "  ", "product.png"]), "product.png");
});

test("business detail uses the catalog parity helpers", () => {
  const screen = fs.readFileSync(
    "src/components/businesses/BusinessDetailScreen.tsx",
    "utf8",
  );
  assert.match(screen, /const showCatalogTab = shouldShowBusinessCatalog/);
  assert.match(screen, /const filteredCatalogItems = getBusinessCatalogItems/);
  assert.match(screen, /src=\{getCatalogItemImage\(item\.images\)\}/);
  const route = fs.readFileSync(
    "src/app/(app)/businesses/[businessId]/BusinessDetailPageClient.tsx",
    "utf8",
  );
  assert.match(route, /logo: getBusinessLogo\(businessData\)/);
  assert.doesNotMatch(route, /logo:\s*businessData\.image_urls/);
});
