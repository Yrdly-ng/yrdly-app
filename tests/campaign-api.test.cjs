const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
function harness({
  user = { id: "00000000-0000-4000-8000-000000000002" },
  admin = false,
  dbError = null,
} = {}) {
  const calls = [];
  const cache = new Map();
  const db = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: { is_admin: admin } }),
      };
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data:
          name === "read_sales_campaign"
            ? {
                participation: { businessId: args.p_actor },
                snapshot: { id: "one" },
              }
            : { saved: true },
        error: dbError,
      };
    },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    new Function("require", "module", "exports", "console", code)(
      (id) => {
        if (id === "next/server")
          return {
            NextResponse: { json: (body, init) => Response.json(body, init) },
          };
        if (id === "@/lib/supabase/supabase-admin")
          return { supabaseAdmin: db };
        if (id === "@/lib/supabase/supabase-server")
          return { getAuthenticatedUser: async () => ({ data: { user } }) };
        if (id.startsWith("@/"))
          return load(path.resolve("src", id.slice(2) + ".ts"));
        if (id.startsWith("."))
          return load(path.resolve(path.dirname(file), id + ".ts"));
        return require(id);
      },
      module,
      module.exports,
      { error() {} },
    );
    cache.set(file, module.exports);
    return module.exports;
  }
  const route = (suffix) =>
    load(path.resolve("src/app/api", suffix, "route.ts"));
  const request = (body) =>
    new Request("https://example.test/api?actor=attacker", {
      method: body ? "POST" : "GET",
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  return { route, calls, request };
}
test("anonymous participation reads and mutations fail before private database access", async () => {
  const h = harness({ user: null });
  for (const [route, method, body] of [
    ["campaigns/small-businesses/me", "GET"],
    [
      "campaigns/small-businesses/participation",
      "POST",
      { businessId: "00000000-0000-4000-8000-000000000020", acceptRules: true },
    ],
  ]) {
    assert.equal((await h.route(route)[method](h.request(body))).status, 401);
  }
  assert.equal(h.calls.length, 0);
});
test("public reads cannot select an actor, while own-rank reads use authenticated identity", async () => {
  const h = harness();
  await h.route("campaigns/small-businesses").GET(h.request());
  assert.equal(h.calls[0].args.p_actor, null);
  await h.route("campaigns/small-businesses/me").GET(h.request());
  assert.equal(h.calls[1].args.p_actor, "00000000-0000-4000-8000-000000000002");
  assert.equal(h.calls[1].args.p_admin, false);
});
test("enrollment rejects score injection, missing consent and unapproved rules version", async () => {
  const h = harness();
  const body = {
    businessId: "00000000-0000-4000-8000-000000000020",
    acceptRules: true,
  };
  for (const patch of [
    { score: 999 },
    { acceptRules: false },
    { rulesVersion: "changed" },
  ])
    assert.equal(
      (
        await h
          .route("campaigns/small-businesses/participation")
          .POST(h.request({ ...body, ...patch }))
      ).status,
      400,
    );
  assert.equal(h.calls.length, 0);
  assert.equal(
    (
      await h
        .route("campaigns/small-businesses/participation")
        .POST(h.request(body))
    ).status,
    200,
  );
  assert.equal(h.calls[0].args.p_actor, "00000000-0000-4000-8000-000000000002");
});
test("private admin evidence requires stored administrator role", async () => {
  const h = harness();
  assert.equal(
    (await h.route("admin/campaigns/small-businesses").GET(h.request())).status,
    403,
  );
  assert.equal(h.calls.length, 0);
  const a = harness({ admin: true });
  assert.equal(
    (await a.route("admin/campaigns/small-businesses").GET(a.request())).status,
    200,
  );
  assert.equal(a.calls[0].args.p_admin, true);
});
test("unavailable database gives retryable error instead of invented zero leaderboard", async () => {
  const h = harness({
    dbError: { code: "unavailable", message: "private transaction detail" },
  });
  const r = await h.route("campaigns/small-businesses").GET(h.request());
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.doesNotMatch(
    JSON.stringify(body),
    /private transaction|entries|completedSales/,
  );
});
