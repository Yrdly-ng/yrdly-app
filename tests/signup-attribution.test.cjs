const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const raw = fs.readFileSync("src/lib/attribution/signup.ts", "utf8");
const compiled = ts.transpileModule(raw, {
  fileName: "signup.ts",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);

function runtime({
  href = "https://app.yrdly.ng/login",
  referrer = "",
  consentedCookie = null,
} = {}) {
  const memory = new Map();
  const document = {
    cookie: consentedCookie ? "yrdly_signup_attribution=" + encodeURIComponent(JSON.stringify(consentedCookie)) : "",
    referrer,
  };
  const window = {
    location: { href },
    sessionStorage: {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); },
    },
  };
  const module = { exports: {} };
  new Function("module", "exports", "window", "document", compiled.outputText)(
    module, module.exports, window, document,
  );
  return { api: module.exports, memory };
}

test("campaign tags survive a marketing-to-app signup journey", () => {
  const r = runtime({
    href: "https://app.yrdly.ng/login?utm_source=instagram&utm_medium=social&utm_campaign=profile_bio",
    referrer: "https://yrdly.ng/?private=secret",
  });
  r.api.captureAcquisitionLanding();
  const attr = r.api.signupAttribution();
  assert.equal(attr.first.source, "instagram");
  assert.equal(attr.last.campaign, "profile_bio");
  assert.equal(attr.version, 1);
  assert.ok(!JSON.stringify(attr).includes("private"));
});

test("cross-domain consented cookie preserves first touch; new campaign updates last touch", () => {
  const cookie = {
    first: { source: "instagram", medium: "social" },
    last: { source: "instagram", medium: "social" },
    captured_at: "2026-11-12T10:00:00.000Z",
  };
  const r = runtime({
    href: "https://app.yrdly.ng/login?utm_source=google&utm_medium=cpc&utm_campaign=launch_02",
    consentedCookie: cookie,
  });
  r.api.captureAcquisitionLanding();
  const value = r.api.signupAttribution();
  assert.equal(value.first.source, "instagram");
  assert.equal(value.last.source, "google");
  assert.equal(value.last.campaign, "launch_02");
});

test("Google Ads click ID is classified, not retained", () => {
  const r = runtime({ href: "https://app.yrdly.ng/?gclid=secret-click-id" });
  const touch = r.api.acquisitionTouch(new URL("https://app.yrdly.ng/?gclid=secret-click-id"), "");
  assert.deepEqual(touch, { source: "google", medium: "cpc" });
  assert.ok(!JSON.stringify(touch).includes("secret-click-id"));
});

test("organic Google referrer preserves domain but drops search terms", () => {
  const r = runtime({ href: "https://app.yrdly.ng/login", referrer: "https://www.google.com/search?q=confidential" });
  r.api.captureAcquisitionLanding();
  const attr = r.api.signupAttribution();
  assert.equal(attr.first.source, "google");
  assert.equal(attr.first.medium, "organic");
  assert.equal(attr.first.referring_domain, "www.google.com");
  assert.ok(!JSON.stringify(attr).includes("confidential"));
});

test("unknown source is explicit; corrupt or PII-bearing tags cannot be stored", () => {
  const direct = runtime();
  assert.equal(direct.api.signupAttribution().first.source, "unknown");
  const invalid = runtime({ href: "https://app.yrdly.ng/login?utm_source=alice%40example.com" });
  invalid.api.captureAcquisitionLanding();
  assert.equal(invalid.api.signupAttribution().first.source, "unknown");
});

test("no registration request may carry arbitrary attribution URLs or credentials", () => {
  const code = fs.readFileSync("src/lib/auth/auth-service.ts", "utf8");
  assert.match(code, /signup_attribution: attribution/);
  assert.match(code, /trackWebAccountCreated\(data\.user\.id, attribution\)/);
  assert.ok(code.indexOf("data.user.identities.length === 0") <
    code.indexOf("trackWebAccountCreated(data.user.id, attribution)"));
  assert.ok(!raw.includes("fbclid"));
});
