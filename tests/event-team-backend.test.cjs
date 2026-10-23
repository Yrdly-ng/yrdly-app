const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const eventId = "10000000-0000-0000-0000-000000000001";
const memberId = "20000000-0000-0000-0000-000000000001";

function harness({
  authError = null,
  user = { id: "caller" },
  result = { data: { success: true }, error: null },
} = {}) {
  const calls = [];
  const scopedClient = {
    rpc: async (name, args) => {
      calls.push({ kind: "rpc", name, args });
      return result;
    },
  };
  const mocks = {
    "server-only": {},
    "next/server": {
      NextResponse: {
        json: (data, init = {}) =>
          new Response(JSON.stringify(data), {
            ...init,
            headers: { "Content-Type": "application/json" },
          }),
      },
    },
    "@supabase/supabase-js": {
      createClient: (url, key, options) => {
        calls.push({ kind: "bearer", url, key, options });
        return scopedClient;
      },
    },
    "@/lib/supabase/supabase-server": {
      getAuthenticatedUser: async () => ({ data: { user }, error: authError }),
      createClient: async () => {
        calls.push({ kind: "cookie" });
        return scopedClient;
      },
    },
    "@/lib/supabase/supabase-url": { brandedSupabaseUrl: (value) => value },
  };
  const cache = {};
  function load(file) {
    if (cache[file]) return cache[file];
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(
      output,
      {
        module,
        exports: module.exports,
        Response,
        process: {
          env: {
            NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
          },
        },
        console: { error() {} },
        require: (name) => {
          if (name in mocks) return mocks[name];
          if (name === "@/lib/events/event-team-server")
            return load("src/lib/events/event-team-server.ts");
          throw new Error(`Unexpected dependency: ${name}`);
        },
      },
      { filename: file },
    );
    cache[file] = module.exports;
    return module.exports;
  }
  const request = (body, bearer = false) =>
    new Request("https://app.yrdly.ng/api/events/team", {
      method: body === undefined ? "GET" : "POST",
      headers: bearer ? { authorization: "Bearer staff-token" } : {},
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  return {
    calls,
    load,
    request,
    context: { params: Promise.resolve({ id: eventId }) },
  };
}

function rpcCalls(h) {
  return h.calls.filter((call) => call.kind === "rpc");
}

test("mobile requests retain their verified Bearer identity through SQL; no caller id parameter", async () => {
  const h = harness();
  const route = h.load("src/app/api/events/checkin/route.ts");
  const response = await route.POST(
    h.request(
      { event_id: eventId, ticket_code: "  YRD-ABC  ", user_id: "owner" },
      true,
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const bearer = h.calls.find((call) => call.kind === "bearer");
  assert.equal(bearer.key, "public-key");
  assert.equal(
    bearer.options.global.headers.Authorization,
    "Bearer staff-token",
  );
  assert.equal(
    JSON.stringify(rpcCalls(h)),
    JSON.stringify([
      {
        kind: "rpc",
        name: "event_team_checkin",
        args: { p_event_id: eventId, p_ticket_code: "YRD-ABC" },
      },
    ]),
  );
});

test("web assignments use the signed-in cookie client and retain active invitation contract", async () => {
  const payload = {
    assignments: [
      { id: memberId, event_id: eventId, role: "checkin", status: "active" },
    ],
  };
  const h = harness({ result: { data: payload, error: null } });
  const response = await h
    .load("src/app/api/events/team/route.ts")
    .GET(h.request());
  assert.deepEqual(await response.json(), payload);
  assert.equal(h.calls[0].kind, "cookie");
  assert.equal(rpcCalls(h)[0].name, "event_team_assignments");
});

test("invalid, suspended, and unavailable sessions cannot reach any operational RPC", async () => {
  for (const status of [401, 403, 503]) {
    const h = harness({ user: null, authError: { status } });
    const response = await h
      .load("src/app/api/events/team/route.ts")
      .GET(h.request());
    assert.equal(response.status, status);
    assert.equal(h.calls.length, 0);
  }
});

test("malformed check-in payloads fail before a database mutation", async () => {
  for (const body of [
    "{",
    [],
    { event_id: eventId, ticket_code: " " },
    { event_id: "invalid", ticket_code: "YRD-X" },
    { event_id: eventId, ticket_code: "A".repeat(201) },
  ]) {
    const h = harness();
    const response = await h
      .load("src/app/api/events/checkin/route.ts")
      .POST(h.request(body));
    assert.equal(response.status, 400);
    assert.equal(rpcCalls(h).length, 0);
  }
});

test("duplicate scan and database authorization errors retain meaningful HTTP status", async () => {
  const duplicate = harness({
    result: {
      data: {
        valid: false,
        error: "ALREADY_SCANNED",
        message: "Ticket already used",
        http_status: 409,
      },
      error: null,
    },
  });
  const response = await duplicate
    .load("src/app/api/events/checkin/route.ts")
    .POST(duplicate.request({ event_id: eventId, ticket_code: "YRD-X" }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    valid: false,
    error: "ALREADY_SCANNED",
    message: "Ticket already used",
  });
  for (const [code, status] of [
    ["42501", 403],
    ["28000", 401],
    ["P0002", 404],
    ["22023", 400],
    ["PGRST202", 503],
  ]) {
    const h = harness({
      result: { data: null, error: { code, message: "DB details" } },
    });
    const r = await h.load("src/app/api/events/team/route.ts").GET(h.request());
    assert.equal(r.status, status);
    if (status === 503)
      assert.doesNotMatch(JSON.stringify(await r.json()), /DB details/);
  }
});

test("invite sends only validated membership fields and cannot grant organizer access", async () => {
  const h = harness();
  const route = h.load("src/app/api/events/[id]/team/route.ts");
  const response = await route.POST(
    h.request({
      action: "invite",
      email: " staff@example.com ",
      role: "checkin",
      status: "accepted",
      organizer_id: "impostor",
    }),
    h.context,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls(h)[0].args)), {
    p_event_id: eventId,
    p_action: "invite",
    p_email: "staff@example.com",
    p_user_id: null,
    p_role: "checkin",
    p_member_id: null,
  });
  for (const body of [
    { action: "invite", email: "staff@example.com", role: "organizer" },
    { action: "invite", email: "invalid", role: "checkin" },
    {
      action: "invite",
      email: "staff@example.com",
      user_id: "invalid",
      role: "checkin",
    },
    { action: "revoke", member_id: "invalid" },
    { action: "update_role", member_id: memberId, role: "owner" },
    { action: "delete_event", member_id: memberId },
  ]) {
    const invalid = harness();
    assert.equal(
      (
        await invalid
          .load("src/app/api/events/[id]/team/route.ts")
          .POST(invalid.request(body), invalid.context)
      ).status,
      400,
    );
    assert.equal(rpcCalls(invalid).length, 0);
  }
});

test("acceptance ignores supplied target and role so SQL binds it to the invited caller", async () => {
  const h = harness({
    result: {
      data: { success: true, member_id: memberId, status: "active" },
      error: null,
    },
  });
  const response = await h
    .load("src/app/api/events/[id]/team/route.ts")
    .POST(
      h.request({
        action: "accept",
        member_id: memberId,
        user_id: eventId,
        role: "manager",
      }),
      h.context,
    );
  assert.equal((await response.json()).status, "active");
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls(h)[0].args)), {
    p_event_id: eventId,
    p_action: "accept",
    p_email: null,
    p_user_id: null,
    p_role: null,
    p_member_id: memberId,
  });
});

test("event snapshot rejects malformed ids and never silently succeeds on empty database output", async () => {
  const h = harness({ result: { data: null, error: null } });
  const route = h.load("src/app/api/events/[id]/team/route.ts");
  assert.equal(
    (await route.GET(h.request(), { params: Promise.resolve({ id: "no" }) }))
      .status,
    400,
  );
  assert.equal(rpcCalls(h).length, 0);
  assert.equal((await route.GET(h.request(), h.context)).status, 503);
});
