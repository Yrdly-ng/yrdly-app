const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { createClient } = require("@supabase/supabase-js");
const screen = fs.existsSync("src/components/location/MapScreen.tsx")
  ? "src/components/location/MapScreen.tsx"
  : "src/app/map.tsx";
function initializer(name) {
  const ast = ts.createSourceFile(
    screen,
    fs.readFileSync(screen, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let text;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
      text = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(text, `${name} must exist`);
  return text;
}
test("actual map queries retain address-only rows, include giveaways, and avoid duplicated or online events", async () => {
  const requests = [];
  const supabase = createClient(
    "https://map-fixture.supabase.co",
    "test-anon",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (url) => {
          requests.push(new URL(url));
          return new Response("[]", {
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
  );
  const compiled = ts.transpileModule(
    `const area=${initializer("area")};const sources=${initializer("sources")};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const sources = new Function(
    "supabase",
    "activeFilter",
    compiled + "return sources;",
  )(supabase, { state: "Lagos", lga: "Ikeja" });
  for (const source of sources) {
    const result = await source.load();
    assert.equal(result.error, null);
  }
  assert.ok(requests.length >= 4);
  for (const request of requests) {
    const filters = request.searchParams.getAll("or").join(",");
    assert.match(filters, /state\.eq\."Lagos",state\.is\.null/);
    assert.match(filters, /lga\.eq\."Ikeja",lga\.is\.null/);
    assert.equal(
      request.searchParams.has("lat"),
      false,
      "address-only rows must not be removed before resolving",
    );
    assert.ok(Number(request.searchParams.get("limit")) <= 50);
  }
  const market = requests.find((r) =>
    r.searchParams.get("category")?.includes("Giveaway"),
  );
  assert.ok(market, "Giveaway listings are included");
  const modern = requests.find((r) => r.pathname.endsWith("/events"));
  assert.ok(modern);
  assert.ok(modern.searchParams.get("select").includes("cover_image_url"));
  const business = requests.find((r) => r.pathname.endsWith("/businesses"));
  assert.ok(business.searchParams.get("select").includes("logo_url"));
  assert.ok(market.searchParams.get("select").includes("image_urls"));
  assert.match(
    modern.searchParams.getAll("or").join(","),
    /location_online\.eq\.false,location_online\.is\.null/,
  );
  const legacy = requests.find(
    (r) => r.searchParams.get("category") === "eq.Event",
  );
  assert.ok(legacy, "legacy event posts remain visible");
  const migratedFilter = legacy.searchParams.getAll("or").join(",");
  assert.match(migratedFilter, /event_link\.is\.null/);
  assert.match(migratedFilter, /event_link\.not\.like\.yrdly:\/\/events\//);
});

test("forward geocoding stays on the restricted Google endpoint and preserves reverse lookups", () => {
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync("src/lib/location/maps-proxy.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function("module", "exports", "require", code)(
    module,
    module.exports,
    (id) => {
      assert.equal(id, "server-only");
      return {};
    },
  );
  const { buildMapsRequest } = module.exports;
  const url = buildMapsRequest(
    ["geocode", "json"],
    new URLSearchParams({
      address: " Fixture public venue, Lagos ",
      key: "untrusted",
      language: "fr",
      components: "country:us",
    }),
  );
  assert.equal(url.origin, "https://maps.googleapis.com");
  assert.equal(url.pathname, "/maps/api/geocode/json");
  assert.equal(url.searchParams.get("address"), "Fixture public venue, Lagos");
  assert.equal(url.searchParams.get("components"), "country:ng");
  assert.equal(url.searchParams.get("language"), "en");
  assert.equal(url.searchParams.has("key"), false);
  for (const query of [
    new URLSearchParams({ address: "", latlng: "6,3" }),
    new URLSearchParams({ address: "x".repeat(301) }),
    new URLSearchParams("address=first&address=second"),
    new URLSearchParams({ address: "Lagos", callback: "unsafe" }),
  ]) {
    assert.throws(() => buildMapsRequest(["geocode", "json"], query));
  }
  const reverse = buildMapsRequest(
    ["geocode", "json"],
    new URLSearchParams({ latlng: "6.5,3.4" }),
  );
  assert.equal(reverse.searchParams.get("latlng"), "6.5,3.4");
});
