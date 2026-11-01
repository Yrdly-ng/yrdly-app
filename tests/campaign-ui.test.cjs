const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function runtime({ sessionUser = "owner", fetchResult, status = 200 } = {}) {
  const requests = [];
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const module = { exports: {} };
    const code = ts.transpileModule(
      readFileSync(
        path.resolve("src/components/campaigns", `${name}.tsx`),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      },
    ).outputText;
    new Function("require", "module", "exports", "fetch", code)(
      (id) => {
        if (
          id === "react" ||
          id === "react/jsx-runtime" ||
          id === "lucide-react"
        )
          return require(id);
        if (id === "next/link")
          return {
            __esModule: true,
            default: ({ children, ...props }) =>
              React.createElement("a", props, children),
          };
        if (id === "@/hooks/use-supabase-auth")
          return { useAuth: () => ({ user: { id: sessionUser } }) };
        if (id === "@/lib/supabase/supabase")
          return {
            supabase: {
              auth: {
                getSession: async () => ({
                  data: {
                    session: sessionUser
                      ? {
                          user: { id: sessionUser },
                          access_token: "fixture-only-token",
                        }
                      : null,
                  },
                }),
              },
            },
          };
        if (id === "@/components/ui/avatar")
          return {
            Avatar: ({ children, ...props }) =>
              React.createElement("span", props, children),
            AvatarImage: (props) => React.createElement("img", props),
            AvatarFallback: ({ children }) =>
              React.createElement("span", null, children),
          };
        if (id.startsWith("./")) return load(id.slice(2));
        throw new Error(`Unexpected dependency ${id}`);
      },
      module,
      module.exports,
      async (url, options) => {
        requests.push({ url, options });
        return {
          ok: status >= 200 && status < 300,
          json: async () => fetchResult,
        };
      },
    );
    cache.set(name, module.exports);
    return module.exports;
  }
  return { ...load("CampaignScreen"), requests };
}

const entry = {
  rank: 1,
  businessId: "leader",
  name: "Ada’s shop",
  logoUrl: null,
  profilePath: "/businesses/leader",
  completedSales: 12,
};
function fixture(overrides = {}) {
  return {
    campaign: { status: "active", integrityReviewRequired: false },
    snapshot: {
      id: "same-snapshot",
      updatedAt: "2026-11-04T12:00:00Z",
      provisional: true,
      entries: [entry],
      participantCount: 80,
    },
    participation: { businessId: "owned", status: "approved" },
    ownEntry: {
      ...entry,
      rank: 75,
      businessId: "owned",
      name: "My business",
      completedSales: 2,
    },
    ...overrides,
  };
}
function dashboard(data, options = {}) {
  const { CampaignDashboard } = runtime();
  return renderToStaticMarkup(
    React.createElement(CampaignDashboard, {
      data,
      error: "",
      refreshing: false,
      onRefresh() {},
      ...options,
    }),
  );
}

test("server ranks and counts are preserved, including own business outside leading results", () => {
  const html = dashboard(fixture());
  assert.match(html, /Rank 75/);
  assert.match(html, /My business/);
  assert.match(html, /Your business/);
  assert.match(html, /Rank 1/);
  assert.match(html, /Calculated/);
  assert.match(html, /Nigeria time/);
  assert.doesNotMatch(html, /buyerId|sellerId|fixture-only-token/);
});

test("own business appears once when it is already in the leading results", () => {
  const own = {
    ...entry,
    businessId: "owned",
    name: "My business",
    completedSales: 12,
  };
  const html = dashboard(
    fixture({
      ownEntry: own,
      snapshot: { ...fixture().snapshot, entries: [own, entry] },
    }),
  );
  assert.equal((html.match(/My business/g) || []).length, 1);
  assert.equal((html.match(/aria-label="Rank 1"/g) || []).length, 2);
  assert.match(html, /Your business/);
});

test("equal server ranks remain tied instead of being renumbered by row position", () => {
  const first = entry;
  const second = { ...entry, businessId: "second", name: "Second shop" };
  const third = {
    ...entry,
    businessId: "third",
    name: "Third shop",
    rank: 3,
    completedSales: 9,
  };
  const html = dashboard(
    fixture({
      ownEntry: null,
      snapshot: { ...fixture().snapshot, entries: [first, second, third] },
    }),
  );
  assert.equal((html.match(/aria-label="Rank 1"/g) || []).length, 2);
  assert.match(html, /aria-label="Rank 3"/);
  assert.doesNotMatch(html, /aria-label="Rank 2"/);
});

test("failed initial load is an error, never a zero-sales result", () => {
  const html = dashboard(null, { error: "Offline" });
  assert.match(html, /role="alert"/);
  assert.match(html, /Scores could not be loaded/);
  assert.doesNotMatch(
    html,
    /0 approved|No qualifying completed sales|The starting line/,
  );
});

test("refresh failure preserves known standings and labels them stale", () => {
  const html = dashboard(fixture(), { error: "Offline" });
  assert.match(html, /may be stale/);
  assert.match(html, /Ada/);
  assert.match(html, /Rank 75/);
});

test("initial loading is announced without invented standings", () => {
  const html = dashboard(null, { refreshing: true });
  assert.match(html, /Loading campaign standings/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /0 approved|completed sales<\/p>/);
});

test("campaign upcoming, review and final states explain their actual status", () => {
  for (const [status, expected] of [
    ["upcoming", "Coming 1 November"],
    ["review", "No winner has been announced"],
    ["finalized", "Reviewed final results"],
  ]) {
    const html = dashboard(
      fixture({ campaign: { status, integrityReviewRequired: false } }),
    );
    assert.ok(html.includes(expected), status);
  }
});

test("empty participants and approved zero-sale businesses are distinct states", () => {
  const base = fixture();
  const empty = dashboard(
    fixture({
      ownEntry: null,
      snapshot: { ...base.snapshot, participantCount: 0, entries: [] },
    }),
  );
  assert.match(empty, /No businesses have been approved/);
  const zero = dashboard(
    fixture({
      ownEntry: null,
      snapshot: {
        ...base.snapshot,
        participantCount: 1,
        entries: [{ ...entry, completedSales: 0 }],
      },
    }),
  );
  assert.match(zero, /No qualifying completed sales/);
  assert.doesNotMatch(zero, /No businesses have been approved/);
});

test("a changed auth identity cannot use another account session for participation", async () => {
  const app = runtime({ sessionUser: "different-owner" });
  await assert.rejects(
    () => app.campaignRequest("/api/campaigns/small-businesses/me", "owner"),
    /sign in again/,
  );
  assert.equal(app.requests.length, 0);
});

test("enrollment sends business and consent without a score and propagates provider-safe API failures", async () => {
  const app = runtime({
    fetchResult: { error: "Enrollment is closed." },
    status: 409,
  });
  await assert.rejects(
    () =>
      app.campaignRequest(
        "/api/campaigns/small-businesses/participation",
        "owner",
        undefined,
        { businessId: "owned", acceptRules: true },
      ),
    /Enrollment is closed/,
  );
  assert.deepEqual(JSON.parse(app.requests[0].options.body), {
    businessId: "owned",
    acceptRules: true,
  });
  assert.equal(app.requests[0].options.cache, "no-store");
});
