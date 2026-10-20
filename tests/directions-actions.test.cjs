const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function load(file, imports = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("module", "exports", "require", code)(
    module,
    module.exports,
    (name) => imports[name] || require(name),
  );
  return module.exports;
}
test("listing, event and business direction actions link to their destination inside Yrdly", () => {
  const client = load("src/lib/location/directions-client.ts");
  const { GetDirectionsLink } = load(
    "src/components/location/GetDirectionsLink.tsx",
    { "@/lib/location/directions-client": client },
  );
  for (const type of ["marketplace", "event", "business"]) {
    const html = renderToStaticMarkup(
      React.createElement(GetDirectionsLink, {
        target: { type, id: "fixture" },
      }),
    );
    assert.ok(
      html.includes(`/map?destinationType=${type}&amp;destinationId=fixture`),
    );
    assert.ok(html.includes("Get directions"));
    assert.ok(!html.includes('target="_blank"'));
    assert.ok(!html.includes("maps.google"));
  }
});
