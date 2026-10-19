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
