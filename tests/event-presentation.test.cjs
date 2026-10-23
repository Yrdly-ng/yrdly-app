const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const moduleObject = { exports: {} };
new Function(
  "module",
  "exports",
  ts.transpileModule(
    fs.readFileSync("src/lib/events/event-presentation.ts", "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  ).outputText,
)(moduleObject, moduleObject.exports);
const { getEventPriceLabel, getEventDateInfo } = moduleObject.exports;
const format = (amount) => `₦${amount.toFixed(2)}`;

test("unknown or malformed event prices never advertise free entry", () => {
  for (const price of [
    undefined,
    null,
    "",
    " ",
    "unknown",
    NaN,
    Infinity,
    -1,
  ]) {
    assert.equal(
      getEventPriceLabel({ price }, format),
      "View tickets",
      String(price),
    );
  }
});
test("free, paid and tiered prices reflect the visible offer", () => {
  assert.equal(getEventPriceLabel({ is_free: true }, format), "Free entry");
  assert.equal(getEventPriceLabel({ price: 0 }, format), "Free entry");
  assert.equal(getEventPriceLabel({ price: "1200.50" }, format), "₦1200.50");
  assert.equal(
    getEventPriceLabel(
      { ticket_tiers: [{ price: 2500 }, { price: 1200 }] },
      format,
    ),
    "From ₦1200.00",
  );
  assert.equal(
    getEventPriceLabel(
      { ticket_tiers: [{ price: 0 }, { price: 1200 }] },
      format,
    ),
    "Free & paid tickets",
  );
  assert.equal(
    getEventPriceLabel(
      { ticket_tiers: [{ price: 0, is_visible: false }, { price: 1200 }] },
      format,
    ),
    "From ₦1200.00",
  );
  assert.equal(
    getEventPriceLabel(
      { ticket_tiers: [{ price: 0 }, { price: undefined }] },
      format,
    ),
    "View tickets",
  );
});
test("event dates have useful valid labels and omit invalid dates", () => {
  for (const input of [null, undefined, "", "invalid"])
    assert.equal(getEventDateInfo(input), null);
  const labels = getEventDateInfo("2026-10-24T15:30:00+01:00");
  assert.equal(labels.day, "24");
  assert.equal(labels.month, "OCT");
  assert.match(labels.full, /24 Oct/);
  assert.match(labels.time, /^\d{2}:\d{2}$/);
});

test("weekend means Saturday and Sunday, including Sunday of the current weekend", () => {
  const { matchesEventDay } = moduleObject.exports;
  const friday = new Date(2026, 9, 23, 12);
  assert.equal(
    matchesEventDay(
      new Date(2026, 9, 23, 18).toISOString(),
      "This weekend",
      friday,
    ),
    false,
  );
  assert.equal(
    matchesEventDay(
      new Date(2026, 9, 24, 12).toISOString(),
      "This weekend",
      friday,
    ),
    true,
  );
  assert.equal(
    matchesEventDay(
      new Date(2026, 9, 25, 12).toISOString(),
      "This weekend",
      friday,
    ),
    true,
  );
  assert.equal(
    matchesEventDay(
      new Date(2026, 9, 26, 12).toISOString(),
      "This weekend",
      friday,
    ),
    false,
  );
  const sunday = new Date(2026, 9, 25, 12);
  assert.equal(
    matchesEventDay(sunday.toISOString(), "This weekend", sunday),
    true,
  );
  assert.equal(matchesEventDay("broken", "Today", friday), false);
});
