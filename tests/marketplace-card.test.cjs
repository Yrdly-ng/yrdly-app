const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");
const loaded = { exports: {} };
const source = ts.transpileModule(
  readFileSync("src/lib/marketplace/card-display.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
new Function("exports", source)(loaded.exports);
const { getListingCover, getListingPriceLabel } = loaded.exports;
const photo = "https://images.unsplash.com/listing.jpg";
const thumbnail = "https://images.unsplash.com/thumbnail.jpg";

test("cover selection handles current and legacy arrays without trusting malformed media", () => {
  assert.equal(
    getListingCover({
      image_urls: [null, "", {}, photo],
      image_url: thumbnail,
    }),
    photo,
  );
  assert.equal(getListingCover({ image_urls: JSON.stringify([photo]) }), photo);
  for (const image_urls of [
    "{broken",
    "null",
    "{}",
    "123",
    '"text"',
    [],
    null,
  ]) {
    assert.equal(getListingCover({ image_urls, image_url: photo }), photo);
  }
  assert.equal(
    getListingCover({
      image_urls: ["javascript:alert(1)", "not-a-url"],
      video_thumbnail_url: thumbnail,
    }),
    thumbnail,
  );
  assert.equal(getListingCover({ image_urls: [42, {}] }), undefined);
  assert.equal(
    getListingCover({
      image_urls: [],
      image_url: "",
      video_thumbnail_url: thumbnail,
    }),
    thumbnail,
  );
});

test("price distinguishes a free listing from unavailable or invalid values", () => {
  const format = (amount) => `NGN ${amount}`;
  assert.equal(getListingPriceLabel(0, format), "Free");
  assert.equal(getListingPriceLabel(2500.5, format), "NGN 2500.5");
  for (const price of [undefined, null, NaN, Infinity, -1, "0"]) {
    assert.equal(getListingPriceLabel(price, format), "Price unavailable");
  }
});

const discoveryModule = { exports: {} };
new Function(
  "exports",
  ts.transpileModule(readFileSync("src/lib/marketplace/discovery.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
)(discoveryModule.exports);
const { discoverListings } = discoveryModule.exports;

const catalog = [
  { id: "free", title: "Kitchen shelf", price: 0, created_at: "2026-11-01" },
  {
    id: "cheap",
    title: "Cotton shirt",
    description: "Blue, size medium",
    price: 9500,
    created_at: "2026-11-03",
  },
  {
    id: "boundary",
    title: "Phone case",
    price: 10000,
    created_at: "2026-11-02",
  },
  {
    id: "premium",
    title: "Android phone",
    price: 25000,
    created_at: "2026-11-04",
  },
  { id: "unknown", title: "Dining table", price: null },
  { id: "sold", title: "Cotton shirt", price: 4000, is_sold: true },
];
const ids = (result) => result.map((item) => item.id);

test("budget collections use real, valid prices and exact exclusive limits", () => {
  assert.deepEqual(ids(discoverListings(catalog, { budget: "free" })), [
    "free",
  ]);
  assert.deepEqual(ids(discoverListings(catalog, { budget: "under-10000" })), [
    "cheap",
    "free",
  ]);
  assert.deepEqual(ids(discoverListings(catalog, { budget: "under-25000" })), [
    "cheap",
    "boundary",
    "free",
  ]);
  for (const price of [undefined, null, NaN, Infinity, -1, "0"]) {
    assert.equal(discoverListings([{ price }], { budget: "free" }).length, 0);
    assert.equal(
      discoverListings([{ price }], { budget: "under-10000" }).length,
      0,
    );
  }
});

test("search composes with category and budget, including description and legacy text", () => {
  assert.deepEqual(
    ids(
      discoverListings(catalog, {
        search: "  BLUE shirt ",
        category: "Fashion",
        budget: "under-10000",
      }),
    ),
    ["cheap"],
  );
  assert.deepEqual(
    ids(
      discoverListings(catalog, { search: "Blue shirt", category: "Phones" }),
    ),
    [],
  );
  assert.deepEqual(
    ids(
      discoverListings(
        [
          {
            id: "legacy",
            text: "Wireless headset",
            sub_category: "Electronics",
            price: 2000,
          },
        ],
        { search: "wireless", category: "Electronics" },
      ),
    ),
    ["legacy"],
  );
  assert.deepEqual(
    ids(discoverListings(catalog, { search: "Cotton shirt", budget: "free" })),
    [],
  );
});

test("price sorting keeps unknown values last, excludes sold items and leaves input unchanged", () => {
  const original = JSON.stringify(catalog);
  assert.deepEqual(ids(discoverListings(catalog, { sort: "price-low" })), [
    "free",
    "cheap",
    "boundary",
    "premium",
    "unknown",
  ]);
  assert.deepEqual(ids(discoverListings(catalog, { sort: "price-high" })), [
    "premium",
    "boundary",
    "cheap",
    "free",
    "unknown",
  ]);
  assert.deepEqual(ids(discoverListings(catalog)), [
    "premium",
    "cheap",
    "boundary",
    "free",
    "unknown",
  ]);
  assert.equal(JSON.stringify(catalog), original);
});
