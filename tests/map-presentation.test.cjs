const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function markerToken(failedImage) {
  const path = "src/components/location/MapScreen.tsx";
  const ast = ts.createSourceFile(
    path,
    fs.readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declaration = ast.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "MarkerToken",
  );
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const icon = () => React.createElement("svg", { "data-fallback": true });
  return new Function(
    "React",
    "useState",
    "cn",
    "ICONS",
    "MARKER_COLORS",
    `${code};return MarkerToken;`,
  )(
    React,
    () => [failedImage, () => {}],
    (...classes) => classes.filter(Boolean).join(" "),
    { marketplace: icon, event: icon, business: icon, friend: icon },
    { marketplace: "green", event: "gold", business: "blue", friend: "purple" },
  );
}

test("actual map marker and result token shows each category's image", () => {
  const Token = markerToken();
  for (const type of ["marketplace", "friend", "event", "business"]) {
    const image = `https://fixture.test/${type}.jpg`;
    const html = renderToStaticMarkup(
      React.createElement(Token, { marker: { type, image } }),
    );
    assert.ok(
      html.includes(`<img src="${image}"`),
      `${type} must display its image`,
    );
    assert.ok(!html.includes("data-fallback"));
  }
});

test("missing or failed map images retain an accessible category fallback", () => {
  const image = "https://fixture.test/missing.jpg";
  for (const marker of [{ type: "marketplace" }, { type: "business", image }]) {
    const Token = markerToken(image);
    const html = renderToStaticMarkup(React.createElement(Token, { marker }));
    assert.ok(html.includes("data-fallback"));
    assert.ok(!html.includes("<img"));
  }
});
