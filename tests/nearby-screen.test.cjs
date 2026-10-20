const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
function loadScreen(state) {
  const host = ({ children, contentClassName, ...props }) =>
    React.createElement("div", props, children);
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
        if (name === "@/hooks/use-supabase-auth")
          return { useAuth: () => state.auth };
        if (name === "@/contexts/LocationContext")
          return { useLocation: () => ({ activeFilter: state.location }) };
        if (name === "@/hooks/use-toast")
          return { useToast: () => ({ toast() {} }) };
        if (name === "@/hooks/use-friendship-global")
          return {
            useFriendshipGlobal: () => ({ status: "none", isLoading: false }),
          };
        if (name === "next/navigation")
          return { useRouter: () => ({ push() {} }) };
        if (name === "@/lib/supabase/supabase")
          return { supabase: state.client };
        if (name.startsWith("@/components/ui/"))
          return new Proxy(
            {},
            {
              get: (_, key) =>
                key === "Button"
                  ? ({ children, ...props }) =>
                      React.createElement("button", props, children)
                  : host,
            },
          );
        if (name === "@/components/location/LocationChip")
          return { LocationChip: host };
        if (name.startsWith("@/"))
          return load(path.resolve("src", name.slice(2)) + ".ts");
        if (name.startsWith("."))
          return load(path.resolve(path.dirname(file), name) + ".ts");
        return require(name);
      },
    );
    return module.exports;
  }
  return load("src/components/communities/CommunityScreen.tsx").CommunityScreen;
}
function clientFor(response) {
  return {
    from(table) {
      const calls = [];
      const query = new Proxy(
        {},
        {
          get: (_, key) =>
            key === "then"
              ? (resolve, reject) =>
                  Promise.resolve(response(table, calls)).then(resolve, reject)
              : (...args) => {
                  calls.push([key, ...args]);
                  return query;
                },
        },
      );
      return query;
    },
    rpc(name, args) {
      return {
        abortSignal: (signal) => Promise.resolve(response(name, args, signal)),
      };
    },
    channel() {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel() {},
  };
}
const auth = {
  user: { id: "viewer" },
  profile: { location: { state: "Lagos", lga: "Ikeja" }, blocked_users: [] },
  loading: false,
};
async function mount(response, overrides = {}) {
  const state = {
    auth,
    location: null,
    client: clientFor(response),
    ...overrides,
  };
  const Screen = loadScreen(state);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Screen, state.props)));
  return {
    container,
    state,
    async rerender() {
      await act(async () =>
        root.render(React.createElement(Screen, state.props)),
      );
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
test("Nearby shows an actionable loading failure instead of pretending there are no neighbors", async () => {
  const view = await mount(() => ({
    data: null,
    error: { message: "permission denied", code: "42501" },
  }));
  try {
    assert.match(view.container.textContent, /couldn.t load|unable to load/i);
    assert.ok(
      [...view.container.querySelectorAll("button")].some((button) =>
        /retry|try again/i.test(button.textContent),
      ),
    );
    assert.doesNotMatch(view.container.textContent, /No neighbors found/);
  } finally {
    await view.unmount();
  }
});
module.exports = { mount };
test("an ordinary account sees public profiles when private users RLS returns no other accounts", async () => {
  const tables = [];
  const view = await mount((table) => {
    tables.push(table);
    return {
      data:
        table === "public_profiles"
          ? [
              {
                id: "neighbor",
                name: "Ada Nearby",
                home_state: "Lagos",
                home_lga: "Ikeja",
                discoverable: true,
              },
            ]
          : [],
      error: null,
    };
  });
  try {
    assert.match(view.container.textContent, /Ada Nearby/);
    assert.ok(
      !tables.includes("users"),
      "discovery must not read private account records",
    );
  } finally {
    await view.unmount();
  }
});
test("signed-out auth settles without an endless Nearby skeleton", async () => {
  const view = await mount(() => assert.fail("signed-out should not query"), {
    auth: { user: null, profile: null, loading: false },
  });
  try {
    assert.match(view.container.textContent, /sign in/i);
  } finally {
    await view.unmount();
  }
});

test("profile privacy and runtime payloads cannot crash Nearby or expose hidden/blocked users", async () => {
  const view = await mount(
    (table) => ({
      data:
        table === "public_profiles"
          ? [
              null,
              { id: "bad-name", name: { nested: "invalid" }, home_state: 4 },
              { id: "hidden", name: "Hidden Person", discoverable: false },
              { id: "blocked", name: "Blocked Person", discoverable: true },
              { id: "safe", name: "Visible Neighbor", discoverable: null },
            ]
          : [],
      error: null,
    }),
    {
      auth: {
        ...auth,
        profile: { ...auth.profile, blocked_users: ["blocked"] },
      },
    },
  );
  try {
    assert.match(view.container.textContent, /Yrdly neighbor/);
    assert.match(view.container.textContent, /Visible Neighbor/);
    assert.doesNotMatch(
      view.container.textContent,
      /Hidden Person|Blocked Person/,
    );
  } finally {
    await view.unmount();
  }
});
test("All Nigeria honors the selected global scope and Neighbors uses canonical home columns", async () => {
  const calls = [];
  const view = await mount((table, query) => {
    if (table === "public_profiles") calls.push(query);
    return { data: [], error: null };
  });
  try {
    assert.ok(
      !calls[0].some((call) => call[0] === "eq" || call[0] === "contains"),
      "All Nigeria must not silently restore profile location",
    );
    view.state.location = { state: "Lagos", lga: "Ikeja" };
    await view.rerender();
    await act(async () =>
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent === "Neighbors")
        .click(),
    );
    assert.ok(
      calls
        .at(-1)
        .some(
          (call) =>
            call[0] === "eq" && call[1] === "home_state" && call[2] === "Lagos",
        ),
    );
    assert.ok(
      calls
        .at(-1)
        .some(
          (call) =>
            call[0] === "eq" && call[1] === "home_lga" && call[2] === "Ikeja",
        ),
    );
  } finally {
    await view.unmount();
  }
});
test("changing location aborts stale results and only shows people from the current request", async () => {
  let finishOld;
  let oldSignal;
  const view = await mount((table, query) => {
    if (table !== "public_profiles") return { data: [], error: null };
    if (!query.some((call) => call[1] === "home_state")) {
      oldSignal = query.find((call) => call[0] === "abortSignal")[1];
      return new Promise((resolve) => {
        finishOld = resolve;
      });
    }
    return { data: [{ id: "new", name: "Current Neighbor" }], error: null };
  });
  try {
    view.state.location = { state: "Oyo" };
    await view.rerender();
    assert.equal(oldSignal.aborted, true);
    await act(async () =>
      finishOld({
        data: [{ id: "old", name: "Previous Neighbor" }],
        error: null,
      }),
    );
    assert.match(view.container.textContent, /Current Neighbor/);
    assert.doesNotMatch(view.container.textContent, /Previous Neighbor/);
  } finally {
    await view.unmount();
  }
});
test("a stalled auth or transport request times out into a retryable screen", async () => {
  const originalTimeout = global.setTimeout;
  global.setTimeout = (callback, delay, ...args) =>
    originalTimeout(callback, delay === 12000 ? 5 : delay, ...args);
  let view;
  try {
    view = await mount(() => new Promise(() => {}));
    await act(async () => {
      await new Promise((resolve) => originalTimeout(resolve, 20));
    });
    assert.match(view.container.textContent, /couldn't load nearby people/i);
  } finally {
    global.setTimeout = originalTimeout;
    if (view) await view.unmount();
  }
});
test("Communities remains visible when Nearby requests fail and controlled mode supports back navigation", async () => {
  const selected = [];
  const view = await mount(() => ({ data: null, error: { code: "42501" } }), {
    props: {
      mode: "communities",
      onModeChange: (mode) => selected.push(mode),
      communitiesContent: React.createElement(
        "p",
        null,
        "Community directory content",
      ),
    },
  });
  try {
    assert.match(view.container.textContent, /Community directory content/);
    assert.doesNotMatch(view.container.textContent, /couldn't load/i);
    await act(async () =>
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent === "Nearby")
        .click(),
    );
    assert.deepEqual(selected, ["nearby"]);
    view.state.props = { ...view.state.props, mode: "nearby" };
    await view.rerender();
    assert.match(view.container.textContent, /couldn't load nearby people/i);
  } finally {
    await view.unmount();
  }
});
test("a failed circle query does not hide healthy Nearby results and Retry recovers discovery", async () => {
  let failDiscovery = true;
  const view = await mount((table) =>
    table === "public_profiles" && !failDiscovery
      ? { data: [{ id: "ada", name: "Recovered Neighbor" }], error: null }
      : { data: null, error: { code: "42501" } },
  );
  try {
    failDiscovery = false;
    await act(async () =>
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry")
        .click(),
    );
    assert.match(view.container.textContent, /Recovered Neighbor/);
    await act(async () =>
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent.startsWith("My circle"))
        .click(),
    );
    assert.match(view.container.textContent, /couldn't load your circle/i);
  } finally {
    await view.unmount();
  }
});

test("Nearby uses the real Supabase request boundary with public columns and the selected area", async () => {
  const { createClient } = require("@supabase/supabase-js");
  const requests = [];
  const client = createClient(
    "https://fixture.supabase.co",
    "public-fixture-key",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: {
        transport: class {
          close() {}
        },
      },
      global: {
        fetch: async (input) => {
          const url = new URL(typeof input === "string" ? input : input.url);
          requests.push(url);
          const table = url.pathname.split("/").at(-1);
          if (table === "users") return Response.json([]); // users_private_read hides other accounts.
          if (table === "public_profiles") {
            assert.equal(url.searchParams.get("home_state"), "eq.Lagos");
            assert.equal(
              url.searchParams.get("or"),
              "(discoverable.is.null,discoverable.eq.true)",
            );
            assert.doesNotMatch(
              url.searchParams.get("select"),
              /friends|email|phone,/,
            );
            return Response.json([
              {
                id: "neighbor",
                name: "Actual Contract Neighbor",
                home_state: "Lagos",
                home_lga: "Ikeja",
                discoverable: true,
              },
            ]);
          }
          return Response.json([]);
        },
      },
    },
  );
  const channel = { on: () => channel, subscribe: () => channel };
  client.channel = () => channel;
  client.removeChannel = () => Promise.resolve("ok");
  const view = await mount(() => assert.fail("mock query must not be used"), {
    client,
    location: { state: "Lagos", lga: "Ikeja" },
  });
  try {
    assert.match(view.container.textContent, /Actual Contract Neighbor/);
    assert.ok(
      requests.some((url) => url.pathname.endsWith("/public_profiles")),
    );
    assert.ok(!requests.some((url) => url.pathname.endsWith("/users")));
  } finally {
    await view.unmount();
  }
});
