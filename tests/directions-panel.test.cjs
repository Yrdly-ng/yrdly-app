const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://yrdly.test/map",
});
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
function load(file) {
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
    (name) => {
      if (name === "@/lib/supabase/supabase")
        return {
          supabase: {
            auth: {
              getSession: async () => ({
                data: { session: { access_token: "fixture" } },
              }),
            },
          },
        };
      if (name === "next/link")
        return {
          default: ({ children, ...props }) =>
            React.createElement("a", props, children),
        };
      if (name.startsWith("@/"))
        return load(path.resolve("src", name.slice(2)) + ".ts");
      if (name.startsWith(".")) {
        const base = path.resolve(path.dirname(file), name);
        return load(
          fs.existsSync(base + ".tsx") ? base + ".tsx" : base + ".ts",
        );
      }
      return require(name);
    },
  );
  return module.exports;
}
const destination = {
  type: "business",
  id: "bakery",
  title: "Bakery",
  address: "Market Square",
  lat: 6.4,
  lng: 3.2,
  approximate: false,
  href: "/businesses/bakery",
};
const route = {
  destination,
  mode: "driving",
  overview_polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
  distance_meters: 1250,
  duration_seconds: 901,
  steps: [
    { instruction: "Turn left", distance_meters: 120, duration_seconds: 60 },
  ],
  warnings: ["Check local access."],
};
const button = (container, name) =>
  [...container.querySelectorAll("button")].find(
    (value) => value.textContent === name,
  );
async function click(container, name) {
  const found = button(container, name);
  assert.ok(found, `Missing button ${name}`);
  await act(async () => {
    found.click();
  });
}
async function mount(fetcher, origin = { lat: 6.5, lng: 3.4 }) {
  global.fetch = fetcher;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const published = [];
  let closed = false;
  const { DirectionsPanel } = load(
    "src/components/location/DirectionsPanel.tsx",
  );
  await act(async () =>
    root.render(
      React.createElement(DirectionsPanel, {
        target: { type: "business", id: "bakery" },
        currentLocation: origin,
        locating: false,
        locationError: origin ? "" : "Location access denied.",
        onLocate() {},
        onClose() {
          closed = true;
        },
        onDestination() {},
        onRoute(value) {
          published.push(value);
        },
      }),
    ),
  );
  return {
    container,
    published,
    closed: () => closed,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
test("the real panel changes travel mode, clears stale routes, and closes an active request", async () => {
  const requests = [];
  const view = await mount(async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer fixture");
    if (options.method === "GET") return Response.json(destination);
    const body = JSON.parse(options.body);
    requests.push({ body, signal: options.signal });
    if (body.mode === "walking") return new Promise(() => {});
    return Response.json(route);
  });
  try {
    assert.match(view.container.textContent, /16 min · 1.3 km/);
    assert.match(view.container.textContent, /Google Maps/);
    assert.deepEqual(requests[0].body.origin, { lat: 6.5, lng: 3.4 });
    await click(view.container, "Walking");
    assert.equal(requests[1].body.mode, "walking");
    assert.doesNotMatch(view.container.textContent, /16 min/);
    assert.equal(view.published.at(-1), null);
    await click(view.container, " Back to map");
    assert.equal(requests[1].signal.aborted, true);
    assert.equal(view.closed(), true);
  } finally {
    await view.unmount();
  }
});
test("location denial permits choosing a manual starting address and a failed route can be retried", async () => {
  let routeCount = 0;
  let receivedOrigin;
  const view = await mount(async (url, options) => {
    if (String(url).startsWith("/api/directions/destination"))
      return Response.json(destination);
    if (String(url).startsWith("/api/maps/geocode"))
      return Response.json({
        status: "OK",
        results: [
          {
            formatted_address: "Town Hall, Lagos",
            geometry: { location: { lat: 6.6, lng: 3.3 } },
          },
        ],
      });
    receivedOrigin = JSON.parse(options.body).origin;
    return ++routeCount === 1
      ? Response.json(
          { error: "Routing is temporarily unavailable." },
          { status: 503 },
        )
      : Response.json(route);
  }, null);
  try {
    assert.match(view.container.textContent, /Location access denied/);
    assert.equal(routeCount, 0);
    await click(view.container, "Another address");
    const input = view.container.querySelector("input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set.call(input, "Town Hall");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () =>
      view.container
        .querySelector("form")
        .dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await click(view.container, "Town Hall, Lagos");
    assert.deepEqual(receivedOrigin, { lat: 6.6, lng: 3.3 });
    assert.match(
      view.container.textContent,
      /Routing is temporarily unavailable/,
    );
    await click(view.container, "Retry route");
    assert.match(view.container.textContent, /16 min · 1.3 km/);
  } finally {
    await view.unmount();
  }
});
test("a rejected geocode response never becomes a selectable starting point", async () => {
  const view = await mount(
    async (url) =>
      Response.json(
        String(url).includes("/destination")
          ? destination
          : {
              status: "REQUEST_DENIED",
              results: [
                {
                  formatted_address: "Untrusted place",
                  geometry: { location: { lat: 6.6, lng: 3.3 } },
                },
              ],
            },
      ),
    null,
  );
  try {
    await click(view.container, "Another address");
    const input = view.container.querySelector("input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set.call(input, "Town Hall");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () =>
      view.container
        .querySelector("form")
        .dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    assert.equal(button(view.container, "Untrusted place"), undefined);
    assert.match(view.container.textContent, /Address search unavailable/);
  } finally {
    await view.unmount();
  }
});
