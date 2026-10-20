const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function component() {
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync("src/components/location/DirectionsSummary.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function("module", "exports", "require", code)(
    module,
    module.exports,
    require,
  );
  return module.exports.DirectionsSummary;
}
test("the route preview shows distance, ETA, safe instructions and approximate pickup guidance", () => {
  const Summary = component();
  const route = {
    destination: { type: "marketplace", approximate: true },
    mode: "walking",
    distance_meters: 1250,
    duration_seconds: 901,
    warnings: ["Walking route: use caution."],
    steps: [
      {
        instruction: "Turn left onto Main Street <img onerror=bad>",
        distance_meters: 120,
      },
    ],
  };
  const html = renderToStaticMarkup(React.createElement(Summary, { route }));
  assert.ok(html.includes("1.3 km"));
  assert.ok(html.includes("16 min"));
  assert.ok(html.includes("Approximate pickup area"));
  assert.ok(html.includes("Ask the seller"));
  assert.ok(html.includes("Walking route: use caution."));
  assert.ok(html.includes("Turn left onto Main Street &lt;img"));
  assert.ok(!html.includes("<img onerror"));
  assert.ok(html.includes("Google Maps"));
});
