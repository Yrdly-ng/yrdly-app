const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><body></body>", {
  url: "https://yrdly.test/bookings",
});
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
function compile(file, overrides) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (name) => overrides[name] || (name === "react" ? React : require(name)),
    module,
    module.exports,
  );
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mountHook(hook, initial) {
  let args = initial,
    result;
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    result = hook(...args);
    return null;
  }
  await act(async () => root.render(React.createElement(Probe)));
  return {
    get result() {
      return result;
    },
    async rerender(next) {
      args = next;
      await act(async () => root.render(React.createElement(Probe)));
    },
    async unmount() {
      await act(async () => root.unmount());
    },
  };
}
test("available slots discard stale date responses and clear failed availability", async () => {
  const first = deferred(),
    second = deferred();
  const { useAvailableSlots } = compile("src/hooks/use-bookings.ts", {
    "../lib/bookings/booking-service": {
      BookingService: {
        getAvailableSlots: (_business, _service, day) =>
          day === "2026-10-24" ? first.promise : second.promise,
      },
    },
  });
  const app = await mountHook(useAvailableSlots, [
    "shop",
    "service",
    "2026-10-24",
  ]);
  assert.equal(app.result.loading, true);
  await app.rerender(["shop", "service", "2026-10-25"]);
  await act(async () => second.resolve([{ time: "12:00", available: true }]));
  assert.equal(app.result.slots[0].time, "12:00");
  await act(async () => first.resolve([{ time: "09:00", available: true }]));
  assert.equal(app.result.slots[0].time, "12:00");
  await app.rerender(["shop", "service", undefined]);
  assert.deepEqual(app.result.slots, []);
  assert.equal(app.result.loading, false);
  await app.unmount();
  const failing = compile("src/hooks/use-bookings.ts", {
    "../lib/bookings/booking-service": {
      BookingService: {
        getAvailableSlots: async () => {
          throw new Error("Offline");
        },
      },
    },
  });
  const failed = await mountHook(failing.useAvailableSlots, [
    "shop",
    "service",
    "2026-10-26",
  ]);
  assert.deepEqual(failed.result.slots, []);
  assert.equal(failed.result.loading, false);
  assert.equal(failed.result.error, "Offline");
  await failed.unmount();
});
test("customer bookings ignore old account responses after switching account", async () => {
  const old = deferred(),
    next = deferred();
  const { useCustomerBookings } = compile("src/hooks/use-bookings.ts", {
    "../lib/bookings/booking-service": {
      BookingService: {
        getCustomerBookings: (id) =>
          id === "old" ? old.promise : next.promise,
      },
    },
  });
  const app = await mountHook(useCustomerBookings, ["old"]);
  await app.rerender(["next"]);
  await act(async () => next.resolve([{ id: "next-booking" }]));
  await act(async () => old.resolve([{ id: "private-old-booking" }]));
  assert.deepEqual(app.result.bookings, [{ id: "next-booking" }]);
  await app.rerender([undefined]);
  assert.deepEqual(app.result.bookings, []);
  await app.unmount();
});
test("business metadata only displays recorded ratings, location and mode", () => {
  const { getBusinessLocation, getBusinessRating, getBusinessModeLabel } =
    compile("src/lib/businesses/presentation.ts", {});
  assert.equal(getBusinessModeLabel("both"), "Products & services");
  assert.equal(getBusinessLocation({}, " Ikeja ", " Lagos "), "Ikeja, Lagos");
  assert.equal(
    getBusinessLocation({ address: " Market Road " }),
    "Market Road",
  );
  assert.equal(getBusinessRating(0, 0), null);
  assert.equal(getBusinessRating(4.5, 1.5), null);
  assert.equal(getBusinessRating(4.5, 10), "4.5 (10)");
});

function callbackScreen(file, overrides) {
  let cursor = 0;
  const states = [];
  const fakeReact = {
    ...React,
    useEffect() {},
    useState(initial) {
      const index = cursor++;
      if (!(index in states))
        states[index] = typeof initial === "function" ? initial() : initial;
      return [
        states[index],
        (value) => {
          states[index] =
            typeof value === "function" ? value(states[index]) : value;
        },
      ];
    },
  };
  const Component = compile(file, {
    react: fakeReact,
    "next/navigation": {
      useParams: () => ({ businessId: "shop" }),
      useRouter: () => ({ push() {}, back() {} }),
    },
    ...overrides,
  }).default;
  return {
    render() {
      cursor = 0;
      return Component();
    },
  };
}
function nodes(node) {
  return Array.isArray(node)
    ? node.flatMap(nodes)
    : node && typeof node === "object"
      ? [node, ...nodes(node.props?.children)]
      : [];
}
function label(node) {
  return Array.isArray(node)
    ? node.map(label).join(" ")
    : node && typeof node === "object"
      ? label(node.props?.children)
      : String(node ?? "");
}
test("service editor rejects fractional duration before writing and preserves valid service identity", async () => {
  const saved = [];
  const app = callbackScreen(
    "src/app/(app)/businesses/[businessId]/manage-services/page.tsx",
    {
      "@/hooks/use-bookings": {
        useServiceOfferings: () => ({
          offerings: [],
          loading: false,
          error: null,
          refresh() {},
        }),
      },
      "@/lib/bookings/booking-service": {
        BookingService: {
          createServiceOffering: async (value) => saved.push(value),
        },
      },
      "@/lib/shared/constants": { MIN_PAID_PRICE: 1000 },
      "@/lib/marketplace/price-policy": { servicePriceError: () => null },
    },
  );
  nodes(app.render())
    .find(
      (node) => node.type === "button" && /Add a service/i.test(label(node)),
    )
    .props.onClick();
  let tree = app.render();
  nodes(tree)
    .find((node) => node.props?.placeholder === "e.g. Haircut & Beard Trim")
    .props.onChange({ target: { value: "Haircut" } });
  nodes(tree)
    .find((node) => node.type === "input" && node.props?.min === 1)
    .props.onChange({ target: { value: "30.5" } });
  tree = app.render();
  await nodes(tree)
    .find((node) => node.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.equal(saved.length, 0);
  assert.match(label(app.render()), /Valid duration/);
  nodes(app.render())
    .find((node) => node.type === "input" && node.props?.min === 1)
    .props.onChange({ target: { value: "30" } });
  await nodes(app.render())
    .find((node) => node.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].business_id, "shop");
  assert.equal(saved[0].duration_minutes, 30);
});

test("business discovery shows approved real storefronts and retains cards after background errors", async () => {
  let failed = false;
  const filters = [],
    channels = [],
    removed = [];
  const records = [
    {
      id: "shop",
      name: "Ada’s workshop",
      category: "Craft",
      mode: "both",
      description: "Made and mended nearby.",
      is_active: true,
      moderation_status: "approved",
      image_urls: [],
      location: { address: "Market Road, Ikeja" },
      rating: 0,
      review_count: 0,
    },
  ];
  const query = {
    select() {
      return this;
    },
    eq(...args) {
      filters.push(args);
      return this;
    },
    order() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({
        data: failed ? null : records,
        error: failed ? Error("Offline") : null,
      }).then(resolve, reject);
    },
  };
  const channel = () => {
    const value = {
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    };
    channels.push(value);
    return value;
  };
  const module = compile("src/components/businesses/BusinessesScreen.tsx", {
    "next/navigation": {
      useRouter: () => ({ push() {} }),
      useSearchParams: () => new URLSearchParams(),
    },
    "next/image": {
      __esModule: true,
      default: ({ fill, sizes, ...props }) => React.createElement("img", props),
    },
    "@/lib/supabase/supabase": {
      supabase: {
        from: () => query,
        channel,
        removeChannel: async (value) => removed.push(value),
      },
    },
    "@/components/ui/button": {
      Button: ({ children, ...props }) =>
        React.createElement("button", props, children),
    },
    "@/components/ui/skeleton": { Skeleton: () => null },
    "./CreateBusinessDialog": { CreateBusinessDialog: () => null },
    "./BusinessCreatorOnboarding": { BusinessCreatorOnboarding: () => null },
    "@/contexts/LocationContext": {
      useLocation: () => ({ activeFilter: null }),
    },
    "@/hooks/use-supabase-auth": {
      useAuth: () => ({ profile: { phone_verified: true } }),
    },
    "@/lib/businesses/presentation": compile(
      "src/lib/businesses/presentation.ts",
      {},
    ),
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(React.createElement(module.BusinessesScreen)),
    );
    assert.ok(
      filters.some(
        ([key, value]) => key === "moderation_status" && value === "approved",
      ),
    );
    assert.match(host.textContent, /Ada’s workshop/);
    assert.match(host.textContent, /Products & services/);
    assert.match(host.textContent, /Market Road, Ikeja/);
    assert.doesNotMatch(host.textContent, /0\.0|OPEN NOW|km away/);
    if (process.env.YRDLY_BUSINESS_SNAPSHOT)
      fs.writeFileSync(process.env.YRDLY_BUSINESS_SNAPSHOT, host.innerHTML);
    failed = true;
    await act(async () => window.dispatchEvent(new window.Event("focus")));
    assert.match(host.textContent, /Ada’s workshop/);
    assert.ok(host.querySelector('[role="alert"]'));
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
  assert.equal(removed.length, channels.length);
});
