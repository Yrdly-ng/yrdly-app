const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");
const { z } = require("zod");
function load(file, mocks) {
  const m = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
  )(
    (n) => {
      if (n in mocks) return mocks[n];
      throw Error(n);
    },
    m,
    m.exports,
  );
  return m.exports;
}
const cases = load("src/lib/moderation/report-case.ts", {});
function service({
  user = { id: "actor" },
  authError = null,
  profile = { is_admin: true },
  tables = {},
} = {}) {
  let queried = 0;
  const db = {
    from(t) {
      queried++;
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: profile }),
        in: async (col, ids) => ({
          data: (tables[t] || []).filter((x) => ids.includes(x[col])),
        }),
      };
    },
  };
  const mod = load("src/lib/moderation/report-review-server.ts", {
    "next/server": { NextResponse },
    "@/lib/supabase/supabase-server": {
      getAuthenticatedUser: async () => ({ data: { user }, error: authError }),
    },
    "@/lib/supabase/supabase-admin": { supabaseAdmin: db },
    "./report-case": cases,
  });
  return {
    ...mod,
    get queried() {
      return queried;
    },
  };
}
test("report API verifies sign-in and staff authority before reading case data", async () => {
  const request = new NextRequest("https://example.com/api/admin/reports");
  let m = service({ user: null });
  assert.equal((await m.requireReportAdmin(request)).response.status, 401);
  assert.equal(m.queried, 0);
  m = service({ profile: { role: "user", is_admin: false } });
  assert.equal((await m.requireReportAdmin(request)).response.status, 403);
  m = service({ profile: { role: "admin", is_admin: false } });
  assert.equal((await m.requireReportAdmin(request)).user.id, "actor");
});
test("case projection shows names/content and removes child-safety attachment references", async () => {
  const m = service({
    tables: {
      posts: [
        {
          id: "post",
          user_id: "owner",
          text: "Context",
          image_urls: ["private/image"],
          moderation_status: "rejected",
        },
      ],
      users: [
        { id: "owner", name: "Author", is_banned: true },
        { id: "reporter", name: "Reporter" },
      ],
    },
  });
  const input = {
    id: "r",
    reported_post_id: "post",
    user_id: "reporter",
    category: "Child safety",
    image_url: "private/evidence",
    status: "open",
  };
  const [r] = await m.enrichReports("general", [input]);
  assert.equal(r.reportedAccount.name, "Author");
  assert.equal(r.reporter.name, "Reporter");
  assert.equal(r.content.hidden, true);
  assert.deepEqual(r.media, []);
  const [normal] = await m.enrichReports("general", [
    { ...input, category: "Harassment" },
  ]);
  assert.deepEqual(normal.media, ["private/evidence", "private/image"]);
});
test("case actions pass authenticated actor and reject malformed/short reason requests", async () => {
  let calls = [];
  const mod = load("src/app/api/admin/reports/[kind]/[id]/route.ts", {
    "next/server": { NextResponse },
    zod: { z },
    "@/lib/supabase/supabase-admin": {
      supabaseAdmin: {
        rpc: async (...args) => {
          calls.push(args);
          return { error: null };
        },
      },
    },
    "@/lib/moderation/report-case": cases,
    "@/lib/moderation/report-review-server": {
      requireReportAdmin: async () => ({ user: { id: "staff" } }),
    },
  });
  const context = {
    params: Promise.resolve({
      kind: "general",
      id: "33333333-3333-4333-8333-333333333333",
    }),
  };
  const make = (body) =>
    new NextRequest("https://example.com/api/admin/reports/general/id", {
      method: "POST",
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await mod.POST(
        make({ action: "resolve", reason: "x", expectedStatus: "open" }),
        context,
      )
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (
      await mod.POST(
        make({
          action: "resolve",
          reason: "Reviewed evidence",
          expectedStatus: "open",
          actor: "forged",
        }),
        context,
      )
    ).status,
    200,
  );
  assert.equal(calls[0][1].p_actor, "staff");
});
test("case history includes earlier account and content actions alongside new decisions", async () => {
  const m = service({
    tables: {
      report_review_actions: [
        {
          id: "new",
          report_id: "r",
          report_kind: "general",
          created_at: "2026-11-03",
          actor_user_id: "a",
          action: "resolve",
        },
      ],
      content_moderation_actions: [
        {
          id: "old",
          report_id: "r",
          created_at: "2026-11-01",
          actor_user_id: "a",
          action: "hidden",
        },
      ],
      account_moderation_actions: [
        {
          id: "account",
          report_id: "r",
          created_at: "2026-11-02",
          actor_user_id: "a",
          action: "suspend",
        },
      ],
      users: [{ id: "a", name: "Moderator" }],
    },
  });
  const [r] = await m.enrichReports("general", [{ id: "r" }], true);
  assert.deepEqual(
    r.history.map((h) => h.action),
    ["hidden", "suspend", "resolve"],
  );
  assert.ok(r.history.every((h) => h.actorName === "Moderator"));
});

test("actual GET handler returns auth denial before touching reports", async () => {
  for (const status of [401, 403]) {
    let reads = 0;
    const handlers = load("src/app/api/admin/reports/route.ts", {
      "next/server": { NextResponse },
      "@/lib/supabase/supabase-admin": {
        supabaseAdmin: {
          from() {
            reads++;
            throw Error("must not read");
          },
        },
      },
      "@/lib/moderation/report-case": cases,
      "@/lib/moderation/report-review-server": {
        requireReportAdmin: async () => ({
          response: NextResponse.json({ error: "Denied" }, { status }),
        }),
      },
    });
    assert.equal(
      (
        await handlers.GET(
          new NextRequest("https://example.com/api/admin/reports"),
        )
      ).status,
      status,
    );
    assert.equal(reads, 0);
  }
});
test("stale report decision returns conflict without false success", async () => {
  const handlers = load("src/app/api/admin/reports/[kind]/[id]/route.ts", {
    "next/server": { NextResponse },
    zod: { z },
    "@/lib/supabase/supabase-admin": {
      supabaseAdmin: { rpc: async () => ({ error: { code: "40001" } }) },
    },
    "@/lib/moderation/report-case": cases,
    "@/lib/moderation/report-review-server": {
      requireReportAdmin: async () => ({ user: { id: "staff" } }),
    },
  });
  const response = await handlers.POST(
    new NextRequest("https://example.com/case", {
      method: "POST",
      body: JSON.stringify({
        action: "resolve",
        reason: "Evidence reviewed",
        expectedStatus: "open",
      }),
    }),
    {
      params: Promise.resolve({
        kind: "general",
        id: "33333333-3333-4333-8333-333333333333",
      }),
    },
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).success, undefined);
});
