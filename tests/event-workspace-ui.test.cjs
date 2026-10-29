const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
function mount(options = {}) {
  const state = [],
    effects = [],
    calls = [],
    routes = [];
  let cursor = 0,
    first = true;
  const hook = (initial) => {
    const i = cursor++;
    if (!(i in state))
      state[i] = typeof initial === "function" ? initial() : initial;
    return [
      state[i],
      (value) =>
        (state[i] = typeof value === "function" ? value(state[i]) : value),
    ];
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const event = options.event || {
    id: "event-1",
    organizer_id: "owner",
    title: "Garden social",
    status: "PUBLISHED",
    start_time: "2099-01-01",
    end_time: "2099-01-02",
  };
  const query = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      order: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({
        data: event,
        error: options.loadError ? Error("Offline") : null,
      }),
    };
    return q;
  };
  const modules = {
    react: {
      useState: hook,
      useEffect: (fn) => {
        if (first) effects.push(fn);
      },
      useRef: (value) => hook({ current: value })[0],
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/navigation": {
      useParams: () => ({ id: "event-1" }),
      useRouter: () => ({ push: (path) => routes.push(path), back: () => {} }),
    },
    "@/hooks/use-supabase-auth": { useAuth: () => ({ user: { id: "owner" } }) },
    "@/lib/supabase/supabase": { supabase: { from: query } },
    "@/lib/auth/authenticated-fetch": {
      authenticatedFetch: async (...args) => {
        calls.push(args);
        if (options.requestError) throw new Error(options.requestError);
        return { success: true };
      },
    },
    "@/lib/shared/utils": { cn: (...values) => values.join(" ") },
  };
  const requireMock = (name) => {
    if (modules[name]) return modules[name];
    if (name === "next/image") return { __esModule: true, default: "Image" };
    if (name.startsWith("@/components/") || name === "lucide-react")
      return new Proxy({}, { get: (_, key) => key });
    throw Error("Missing import " + name);
  };
  const module = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    ts.transpileModule(
      fs.readFileSync("src/app/(app)/events/[id]/manage/page.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
  )(requireMock, module, module.exports);
  let tree;
  const render = () => {
    cursor = 0;
    tree = module.exports.default();
    first = false;
    return tree;
  };
  return {
    render,
    calls,
    routes,
    get tree() {
      return tree;
    },
    async ready() {
      render();
      effects.splice(0).forEach((fn) => fn());
      await new Promise(setImmediate);
      render();
    },
  };
}
function all(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node))
    return node.flatMap((child) => all(child, predicate));
  return [
    ...(predicate(node) ? [node] : []),
    ...all(node.props?.children, predicate),
  ];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  return (Array.isArray(node) ? node : [node.props?.children])
    .map(text)
    .join("");
}
function button(tree, label) {
  const node = all(
    tree,
    (node) => node.type === "Button" && text(node).trim() === label,
  )[0];
  assert.ok(node, `Missing ${label}`);
  return node;
}
test("cancellation uses authenticated request and communicates refund prerequisites", async () => {
  const app = mount();
  await app.ready();
  button(app.tree, "Cancel Event").props.onClick();
  app.render();
  assert.match(text(app.tree), /paid tickets.*refund/i);
  assert.match(text(app.tree), /checked.in/i);
  assert.equal(
    all(
      app.tree,
      (node) =>
        node.type === "Input" && node.props.placeholder?.includes("weather"),
    ).length,
    0,
  );
  await button(app.tree, "Yes, Cancel Event").props.onClick();
  assert.deepEqual(app.calls, [["/api/events/event-1/cancel", {}]]);
});
test("network failures show retry instead of claiming organiser access denied", async () => {
  const app = mount({ loadError: true });
  await app.ready();
  assert.match(text(app.tree), /could not load this event/i);
  assert.doesNotMatch(text(app.tree), /Organizer Access Only/);
  button(app.tree, "Try again");
});
test("cancelled and ended events do not expose scanner controls", async () => {
  for (const changes of [
    { status: "CANCELLED" },
    { status: "COMPLETED" },
    { end_time: "2020-01-01" },
  ]) {
    const app = mount({
      event: {
        id: "event-1",
        organizer_id: "owner",
        title: "Garden social",
        status: "PUBLISHED",
        start_time: "2020-01-01",
        end_time: "2099-01-02",
        ...changes,
      },
    });
    await app.ready();
    assert.equal(
      all(
        app.tree,
        (node) =>
          node.type === "Button" && text(node).includes("Ticket Scanner"),
      ).length,
      0,
    );
  }
});

test("cancellation rejection keeps its explanation in the confirmation dialog", async () => {
  const app = mount({ requestError: "Refund paid tickets before cancelling." });
  await app.ready();
  button(app.tree, "Cancel Event").props.onClick();
  app.render();
  await button(app.tree, "Yes, Cancel Event").props.onClick();
  app.render();
  assert.match(text(app.tree), /Refund paid tickets before cancelling/);
  assert.equal(
    all(app.tree, (node) => node.type === "Dialog")[0].props.open,
    true,
  );
});
