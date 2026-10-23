const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://yrdly.test/explore",
});
global.window = dom.window;
global.self = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient("https://fixture.supabase.co", "fixture-anon", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async () => Response.json([]) },
});
// Realtime transport is outside this view/navigation fixture.
supabase.channel = () => ({
  on() {
    return this;
  },
  subscribe() {
    return this;
  },
});
supabase.removeChannel = async () => {};
const profile = {
  home_state: "Lagos",
  phone_verified: true,
  blocked_users: [],
};
const account = { user: { id: "viewer" }, profile };
const community = {
  id: "garden-club",
  name: "Garden Club",
  type: "interest",
  member_count: 12,
  privacy: "open",
};
let currentQuery;
let navigate;
const service = {
  listMyCommunities: async () => [community],
  discoverCommunities: async () => [],
  listInvitations: async () => [],
  listMyCommunitySubmissions: async () => [],
  pendingSubmissionNames: async () => [],
  isStaffProfile: () => false,
};
function load(file, cache = new Map()) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const overrides = {
    "next/navigation": {
      useRouter: () => ({ push: navigate, replace: navigate }),
      useSearchParams: () => currentQuery,
    },
    "@/hooks/use-supabase-auth": { useAuth: () => account },
    "@/hooks/use-toast": { useToast: () => ({ toast() {} }) },
    "@/hooks/use-friendship-global": {
      useFriendshipGlobal: () => ({ status: "none", isLoading: false }),
    },
    "@/contexts/LocationContext": {
      useLocation: () => ({ activeFilter: null }),
    },
    "@/lib/supabase/supabase": { supabase },
    "@/lib/communities/community-service": { CommunityService: service },
    "@/lib/notifications/alert-service": {
      AlertService: { getActiveAlerts: async () => [] },
    },
    "@/hooks/use-marketplace-actions": { useMarketplaceActions: () => ({}) },
    "@/components/marketplace/MarketplaceScreen": {
      MarketplaceScreen: () =>
        React.createElement("p", null, "Marketplace fixture"),
    },
    "@/components/events/EventsScreen": {
      EventsScreen: () => React.createElement("p", null, "Events fixture"),
    },
    "@/components/businesses/BusinessesScreen": {
      BusinessesScreen: () =>
        React.createElement("p", null, "Businesses fixture"),
    },
    "@/components/location/LocationChip": { LocationChip: () => null },
  };
  new Function("module", "exports", "require", code)(
    module,
    module.exports,
    (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/")
          ? path.resolve("src", name.slice(2))
          : path.resolve(path.dirname(file), name);
        const found = [base, base + ".tsx", base + ".ts"].find(
          (candidate) =>
            fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
        );
        if (found) return load(found, cache);
      }
      return require(name);
    },
  );
  return module.exports;
}
async function mount(query = "") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const visits = [];
  currentQuery = new URLSearchParams(query);
  const { default: ExplorePage } = load("src/app/(app)/explore/page.tsx");
  const render = () => root.render(React.createElement(ExplorePage));
  navigate = (url) => {
    visits.push(url);
    currentQuery = new URL(url, "https://yrdly.test").searchParams;
    render();
  };
  await act(async () => render());
  return {
    container,
    visits,
    async go(query) {
      await act(async () => {
        currentQuery = new URLSearchParams(query);
        render();
      });
    },
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
async function click(view, label) {
  const button = [...view.container.querySelectorAll("button")].find(
    (node) => node.textContent.trim() === label,
  );
  assert.ok(button, `Missing ${label}`);
  await act(async () => button.click());
}
test("Communities stays inside Explore and browser history restores the selected discovery mode", async () => {
  const view = await mount();
  try {
    await click(view, "Communities");
    assert.equal(view.visits.at(-1), "/explore?tab=discover&mode=communities");
    assert.match(view.container.textContent, /Garden Club/);
    assert.equal(view.container.querySelector("h1").textContent, "Explore");
    assert.ok(
      [...view.container.querySelectorAll("h2")].some(
        (node) => node.textContent === "Communities",
      ),
    );
    await click(view, "Marketplace");
    assert.match(view.visits.at(-1), /mode=communities/);
    await click(view, "Discover");
    assert.match(view.container.textContent, /Garden Club/);
    await view.go("tab=discover&mode=circle");
    assert.ok(
      view.container
        .querySelector('section[aria-label="Community directory"]')
        .closest("[hidden]"),
    );
    assert.ok(
      [...view.container.querySelectorAll("button")].some(
        (node) =>
          node.textContent.includes("My circle") &&
          node.getAttribute("aria-pressed") === "true",
      ),
    );
    await view.go("tab=discover&mode=communities");
    assert.match(view.container.textContent, /Garden Club/);
  } finally {
    await view.close();
  }
});
test("a direct Explore communities URL mounts the directory without loading Nearby first", async () => {
  const view = await mount("tab=discover&mode=communities");
  try {
    assert.match(view.container.textContent, /Garden Club/);
  } finally {
    await view.close();
  }
});

test("switching Nearby and Communities keeps the community search until the user leaves Discover", async () => {
  const view = await mount("tab=discover&mode=communities");
  try {
    const input = view.container.querySelector(
      'input[aria-label="Search communities"]',
    );
    assert.ok(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set.call(input, "Garden");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await click(view, "Nearby");
    await click(view, "Communities");
    assert.equal(
      view.container.querySelector('input[aria-label="Search communities"]')
        .value,
      "Garden",
    );
  } finally {
    await view.close();
  }
});

test("legacy people and communities links redirect into the matching Explore mode", () => {
  for (const [file, expected] of [
    ["src/app/(app)/community/page.tsx", "/explore?tab=discover&mode=nearby"],
    [
      "src/app/(app)/communities/page.tsx",
      "/explore?tab=discover&mode=communities",
    ],
  ]) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    let redirected;
    new Function("module", "exports", "require", code)(
      module,
      module.exports,
      (name) => {
        if (name === "next/navigation")
          return {
            redirect(url) {
              redirected = url;
              throw new Error("fixture redirect");
            },
          };
        if (name === "@/components/communities/CommunityScreen")
          return { CommunityScreen: () => null };
        return require(name);
      },
    );
    assert.throws(() => module.exports.default(), /fixture redirect/);
    assert.equal(redirected, expected);
  }
});
