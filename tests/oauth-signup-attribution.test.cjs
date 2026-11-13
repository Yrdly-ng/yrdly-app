const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function compile(path, jsx = false) {
  const source = fs.readFileSync(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
    },
    reportDiagnostics: true,
  });
  assert.deepEqual(
    (transpiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    [],
    path,
  );
  return transpiled.outputText;
}
function load(code, imports = {}, globals = {}) {
  const module = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(
    name => {
      assert.ok(Object.prototype.hasOwnProperty.call(imports, name), "unexpected import " + name);
      return imports[name];
    },
    module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}
const attributionCode = compile("src/lib/attribution/signup.ts");
const data = load(attributionCode);
const record = {
  version: 1,
  first: { source: "instagram", medium: "social", campaign: "profile_bio" },
  last: { source: "google", medium: "cpc", campaign: "november_ads" },
  captured_at: "2026-11-13T00:00:00Z",
};

test("OAuth redirect carries only bounded first/last marketing tags, never a click ID", () => {
  const dest = new URL("https://app.yrdly.ng/auth/callback?next=%2Fhome");
  data.appendOAuthAttribution(dest, record);
  assert.equal(dest.searchParams.get("next"), "/home");
  const result = data.readOAuthAttribution(dest);
  assert.equal(result.first.source, "instagram");
  assert.equal(result.last.source, "google");
  assert.equal(result.last.campaign, "november_ads");
  assert.ok(!dest.toString().includes("gclid"));
  assert.ok(!dest.toString().includes("email"));
  const invalid = new URL(dest.toString());
  invalid.searchParams.set("acq_fs", "alice@example.com");
  assert.equal(data.readOAuthAttribution(invalid), null);
});

test("Google click ID plus utm_source=google is categorized as paid CPC", () => {
  const touch = data.acquisitionTouch(new URL("https://app.yrdly.ng/login?utm_source=google&gclid=private-123"), "");
  assert.equal(touch.source, "google");
  assert.equal(touch.medium, "cpc");
  assert.ok(!JSON.stringify(touch).includes("private-123"));
});

test("Google Ads emits once on app.yrdly.ng, with random ID rather than account ID", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const sent = [];
  const stored = new Map();
  const win = {
    location: { hostname: "app.yrdly.ng" },
    sessionStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    crypto: { randomUUID: () => "999e4567-e89b-42d3-a456-426614174000" },
    gtag: (...args) => sent.push(args),
  };
  const ads = load(compile("src/lib/attribution/google-ads.ts"), {}, { window: win });
  assert.equal(ads.reportGoogleAdsSignup(id), true);
  assert.equal(ads.reportGoogleAdsSignup(id), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "event");
  assert.equal(sent[0][1], "conversion");
  assert.equal(sent[0][2].transaction_id, "999e4567-e89b-42d3-a456-426614174000");
  assert.ok(!JSON.stringify(sent).includes(id));
});

test("Google Ads never sends from preview origins", () => {
  const win = { location: { hostname: "preview.vercel.app" }, sessionStorage: {}, crypto: {} };
  const ads = load(compile("src/lib/attribution/google-ads.ts"), {}, { window: win });
  assert.equal(ads.reportGoogleAdsSignup("123e4567-e89b-42d3-a456-426614174000"), false);
});

test("OAuth event server and callback are TypeScript-valid", () => {
  compile("src/lib/attribution/server-events.ts");
  compile("src/app/auth/callback/route.ts");
  compile("src/components/providers/SignupConversionHandler.tsx", true);
});

test("OAuth accounts are counted only on a first-time provider profile bootstrap", async () => {
  const providerId = "123e4567-e89b-42d3-a456-426614174000";
  const made = [], captured = [];
  const serverCode = compile("src/app/auth/callback/route.ts");
  const fakeSession = {
    user: {
      id: providerId,
      created_at: new Date().toISOString(),
      email: "someone@example.com",
      user_metadata: { name: "Test" },
      app_metadata: { provider: "google" },
    },
  };
  const mockedSupabase = {
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getSession: async () => ({ data: { session: fakeSession } }),
      updateUser: async value => { made.push(["metadata", value]); return { error: null }; },
    },
    from: table => {
      assert.equal(table, "users");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: async value => { made.push(["profile", value]); return { error: null }; },
      };
    },
  };
  const route = load(serverCode, {
    "@/lib/attribution/signup": data,
    "@/lib/attribution/server-events": {
      captureNewOAuthAccount: async (uid, method, attribution) =>
        captured.push({ uid, method, attribution }),
    },
    "@/lib/auth/auth-navigation": { safeRelativePath: x => x ?? "" },
    "next/server": { NextResponse: { redirect: url => ({ url: String(url), status: 302 }) } },
    "@/lib/supabase/supabase-server": { createClient: async () => mockedSupabase },
  }, { URL, Date, console });
  const url = new URL("https://app.yrdly.ng/auth/callback?code=abc123");
  data.appendOAuthAttribution(url, record);
  const response = await route.GET({ url: url.toString() });
  assert.equal(response.status, 302);
  assert.match(response.url, /new_signup=google/);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].method, "google");
  assert.equal(captured[0].attribution.first.source, "instagram");
  assert.equal(made.length, 2);
  // Old accounts with a missing public profile must not be counted as new.
  fakeSession.user.created_at = "2026-10-01T00:00:00Z";
  captured.length = 0;
  const old = await route.GET({ url: url.toString() });
  assert.doesNotMatch(old.url, /new_signup/);
  assert.equal(captured.length, 0);
});
