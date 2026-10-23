const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><body></body>", {
  url: "https://yrdly.test/events",
});
global.window = dom.window;
global.document = dom.window.document;
global.self = dom.window;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const routes = [],
  writes = [];
let fail = false,
  verified = true;
const events = [
  {
    id: "unknown",
    title: "Neighbourhood walk",
    start_time: "2099-10-24T12:00:00Z",
    category: "Outdoors",
    location_address: "Lagos",
  },
  {
    id: "free",
    title: "Garden meet-up",
    start_time: "2099-10-25T12:00:00Z",
    category: "Community",
    location_address: "Ikeja",
    ticket_tiers: [{ price: 0, is_visible: true }],
  },
  {
    id: "paid",
    title: "Local supper club",
    start_time: "2099-10-25T15:00:00Z",
    category: "Food",
    location_address: "Yaba",
    ticket_tiers: [{ price: 1500, is_visible: true }],
  },
];
const chain = {
  select() {
    return this;
  },
  eq() {
    return this;
  },
  maybeSingle: async () => ({ data: null }),
  insert: async (row) => {
    writes.push(row);
    return { error: null };
  },
  delete() {
    return this;
  },
  match: async () => ({ error: null }),
};
function load(file) {
  file = path.resolve(file);
  const module = { exports: {} };
  const overrides = {
    react: React,
    "next/navigation": {
      useRouter: () => ({ push: (url) => routes.push(url) }),
    },
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) =>
        React.createElement("a", props, children),
    },
    "next/image": {
      __esModule: true,
      default: ({ fill, sizes, ...props }) => React.createElement("img", props),
    },
    "@/hooks/use-supabase-auth": {
      useAuth: () => ({
        user: { id: "viewer" },
        profile: { phone_verified: verified },
      }),
    },
    "@/contexts/LocationContext": {
      useLocation: () => ({ activeFilter: null }),
    },
    "@/lib/events/event-service": {
      getPublishedEvents: async () => {
        if (fail) throw Error("Offline");
        return events;
      },
    },
    "@/lib/supabase/supabase": { supabase: { from: () => chain } },
    "@/components/ui/skeleton": {
      Skeleton: ({ className }) => React.createElement("div", { className }),
    },
    "./EventCreatorOnboarding": {
      EventCreatorOnboarding: ({ isOpen, onContinue }) =>
        isOpen
          ? React.createElement(
              "button",
              { onClick: onContinue },
              "Continue event setup",
            )
          : null,
    },
  };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (name) => {
      if (overrides[name]) return overrides[name];
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/")
          ? path.resolve("src", name.slice(2))
          : path.resolve(path.dirname(file), name);
        const found = [base + ".tsx", base + ".ts"].find(fs.existsSync);
        if (found) return load(found);
      }
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}
async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const { EventsScreen } = load("src/components/events/EventsScreen.tsx");
  await act(async () => root.render(React.createElement(EventsScreen)));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function click(node) {
  assert.ok(node);
  await act(async () =>
    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
  );
}
const button = (host, label) =>
  [...host.querySelectorAll("button")].find(
    (node) => node.textContent.trim() === label,
  );
test("event discovery exposes real ticket/hosting routes and factual price filters", async () => {
  const view = await mount();
  try {
    assert.ok(view.host.querySelector('a[href="/my-tickets"]'));
    assert.ok(view.host.querySelector('a[href="/my-events"]'));
    assert.equal(view.host.querySelectorAll("article").length, 3);
    assert.match(
      view.host.querySelector("article").textContent,
      /View tickets/,
    );
    await click(button(view.host, "Free"));
    assert.equal(view.host.querySelectorAll("article").length, 1);
    assert.match(
      view.host.querySelector("article").textContent,
      /Garden meet-up/,
    );
    await click(button(view.host, "All"));
    const card = view.host.querySelector(
      'button[aria-label="View Neighbourhood walk"]',
    );
    await click(card);
    assert.equal(routes.at(-1), "/events/unknown");
    const before = routes.length;
    await click(view.host.querySelector('button[aria-label="Save event"]'));
    assert.equal(routes.length, before);
    assert.equal(writes.at(-1).event_id, "unknown");
    assert.ok(view.host.querySelector('button[aria-label="Unsave event"]'));
    await click(button(view.host, "Create event"));
    await click(button(view.host, "Continue event setup"));
    assert.equal(routes.at(-1), "/events/create");
    if (process.env.YRDLY_UI_SNAPSHOT)
      fs.writeFileSync(process.env.YRDLY_UI_SNAPSHOT, view.host.innerHTML);
  } finally {
    await view.close();
  }
});
test("failed event loading offers retry and phone verification still gates creation", async () => {
  fail = true;
  verified = false;
  const view = await mount();
  try {
    assert.ok(view.host.querySelector('[role="alert"]'));
    assert.doesNotMatch(view.host.textContent, /A little quiet/);
    fail = false;
    await click(button(view.host, "Try again"));
    assert.equal(view.host.querySelectorAll("article").length, 3);
    await click(button(view.host, "Create event"));
    assert.equal(routes.at(-1), "/verify-phone");
  } finally {
    fail = false;
    verified = true;
    await view.close();
  }
});
