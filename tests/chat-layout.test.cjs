const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const { clsx } = require("clsx");
const { twMerge } = require("tailwind-merge");

// Render the real layout, replacing only unrelated providers and leaf widgets.
function renderLayout(pathname) {
  const source = ts.transpileModule(
    readFileSync("src/components/layout/MainLayout.tsx", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } },
  ).outputText;
  const loaded = { exports: {} };
  const empty = () => null;
  const dependency = (name) => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "next/navigation") return { usePathname: () => pathname, useRouter: () => ({}) };
    if (name === "@/hooks/use-supabase-auth") return { useAuth: () => ({ user: null, profile: null }) };
    if (name === "@/lib/shared/utils") return { cn: (...args) => twMerge(clsx(args)) };
    if (name === "@/components/ErrorBoundary") return { ErrorBoundary: ({ children }) => children };
    if (name === "@/lib/shared/layout-utils") return { getPageWidthTier: () => "" };
    if (name === "./Topbar") return { Topbar: () => React.createElement("nav", { "data-testid": "topbar" }) };
    if (name === "./BottomNav") return { BottomNav: () => React.createElement("nav", { "data-testid": "bottom-nav" }) };
    return new Proxy({}, { get: () => empty });
  };
  new Function("require", "module", "exports", source)(dependency, loaded, loaded.exports);
  return renderToStaticMarkup(React.createElement(loaded.exports.MainLayout, null,
    React.createElement("div", { style: { height: "100%" } }, "conversation")));
}

async function mainStyles(markup, width) {
  const classes = markup.match(/<main class="([^"]+)"/)[1];
  // Tailwind itself resolves spacing/responsive rules; assertions inspect the
  // resulting CSS box model, not hard-coded class-name expectations.
  const result = await postcss([tailwind({ content: [{ raw: markup }], corePlugins: { preflight: false } })])
    .process(`.layout-probe { @apply ${classes}; }`, { from: undefined });
  const styles = {};
  result.root.walkRules((rule) => {
    if (rule.selector !== ".layout-probe") return;
    let parent = rule.parent;
    while (parent) {
      if (parent.type === "atrule" && parent.name === "media") {
        const minimum = parent.params.match(/min-width:\s*(\d+)px/);
        if (minimum && width < Number(minimum[1])) return;
      }
      parent = parent.parent;
    }
    rule.walkDecls((decl) => {
      if (decl.prop === "padding") {
        const [top, right = top, bottom = top, left = right] = decl.value.split(/\s+/);
        Object.assign(styles, { "padding-top": top, "padding-right": right, "padding-bottom": bottom, "padding-left": left });
      } else styles[decl.prop] = decl.value;
    });
  });
  return styles;
}

function pixels(value, viewportHeight) {
  assert.ok(value, "chat main must have a definite height for its h-full descendants");
  const expression = value.replace(/^calc\((.*)\)$/, "$1")
    .replace(/([\d.]+)dvh/g, (_, n) => String(Number(n) * viewportHeight / 100))
    .replace(/([\d.]+)rem/g, (_, n) => String(Number(n) * 16))
    .replace(/px/g, "");
  assert.match(expression, /^[\d. +\-]+$/);
  return Function(`return (${expression})`)();
}

for (const pathname of ["/messages/conversation-id", "/businesses/business-id/chat"]) {
  test(`${pathname}: chat fills available viewport without reserving hidden navigation`, async () => {
    const markup = renderLayout(pathname);
    assert.doesNotMatch(markup, /data-testid="(?:topbar|bottom-nav)"/);
    for (const [width, viewportHeight] of [[390, 844], [390, 470], [768, 1024], [1440, 900]]) {
      const styles = await mainStyles(markup, width);
      const contentHeight = pixels(styles.height, viewportHeight)
        - pixels(styles["padding-top"] || "0", viewportHeight)
        - pixels(styles["padding-bottom"] || "0", viewportHeight);
      assert.equal(viewportHeight - contentHeight, 0,
        `${width}x${viewportHeight}: blank space below full-height conversation`);
      assert.equal(styles["overflow-y"] || styles.overflow, "hidden");
    }
  });
}

for (const pathname of ["/messages", "/explore"]) {
  test(`${pathname}: list retains space for visible mobile navigation`, async () => {
    const markup = renderLayout(pathname);
    assert.match(markup, /data-testid="topbar"/);
    assert.match(markup, /data-testid="bottom-nav"/);
    const mobile = await mainStyles(markup, 390);
    assert.equal(pixels(mobile.height, 844), 780);
    assert.equal(pixels(mobile["padding-bottom"], 844), 80);
    const desktop = await mainStyles(markup, 1440);
    assert.equal(pixels(desktop.height, 900), 900);
    assert.equal(pixels(desktop["padding-bottom"], 900), 0);
  });
}
