const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const env = {
  NODE_ENV: "production",
  NEXT_PUBLIC_POSTHOG_KEY: "phc_fixture",
  NEXT_PUBLIC_SENTRY_DSN: "https://public@example.invalid/1",
};
function runtime({ config = env, browser = true, fail = false } = {}) {
  const calls = [];
  let analyticsOptions;
  let sentryOptions;
  const call = (name, ...args) => {
    calls.push([name, ...args]);
    if (fail) throw new Error("offline");
  };
  const ph = {
    init(key, options) {
      call("ph.init", key);
      analyticsOptions = options;
    },
    identify: (id) => call("identify", id),
    reset: (flag) => call("reset", flag),
    capture: (...args) => call("capture", ...args),
  };
  const sentry = {
    init(options) {
      call("sentry.init");
      sentryOptions = options;
    },
    getClient() {
      return sentryOptions ? { getOptions: () => sentryOptions } : undefined;
    },
    setUser: (user) => call("user", user),
    captureException: (...args) => call("exception", ...args),
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    new Function("require", "module", "exports", "process", "window", compiled)(
      (id) => {
        if (id === "posthog-js") return { __esModule: true, default: ph };
        if (id === "@sentry/nextjs") return sentry;
        assert.ok(id.startsWith("./"));
        return load(path.resolve(path.dirname(file), id + ".ts"));
      },
      module,
      module.exports,
      { env: config },
      browser ? {} : undefined,
    );
    return module.exports;
  }
  return {
    load: (name) => load(path.resolve("src/lib/telemetry", name + ".ts")),
    calls,
    get analyticsOptions() {
      return analyticsOptions;
    },
    get sentryOptions() {
      return sentryOptions;
    },
  };
}

test("SDKs stay inactive without config, in development, on server analytics, or with kill switch", async () => {
  for (const options of [
    { config: {} },
    { config: { ...env, NODE_ENV: "development" } },
    { config: { ...env, NEXT_PUBLIC_TELEMETRY_DISABLED: "true" } },
  ]) {
    const r = runtime(options);
    const a = r.load("analytics");
    const s = r.load("sentry");
    s.initializeWebSentry("browser");
    s.captureWebError(new Error("private"));
    await a.trackWebPage("/home");
    await a.trackWebEvent("message_sent");
    assert.deepEqual(r.calls, []);
  }
  const r = runtime({ browser: false });
  await r.load("analytics").trackWebPage("/home");
  r.load("sentry").setWebUser(A);
  assert.deepEqual(r.calls, []);
});

test("once-only initialization, deduplicated page views, and reset before switching identities", async () => {
  const r = runtime();
  const a = r.load("analytics");
  a.setWebAnalyticsUser(A);
  await Promise.all([a.initializeWebAnalytics(), a.initializeWebAnalytics()]);
  await a.trackWebPage("/home");
  await a.trackWebPage("/home");
  a.setWebAnalyticsUser(A);
  a.setWebAnalyticsUser(B);
  a.setWebAnalyticsUser(null);
  assert.deepEqual(
    r.calls.filter(([n]) => n !== "capture"),
    [
      ["ph.init", "phc_fixture"],
      ["identify", A],
      ["reset", true],
      ["identify", B],
      ["reset", true],
    ],
  );
  assert.equal(r.calls.filter(([n]) => n === "capture").length, 1);
  assert.equal(r.analyticsOptions.persistence, "memory");
  assert.equal(r.analyticsOptions.autocapture, false);
  assert.equal(r.analyticsOptions.disable_session_recording, true);
  assert.equal(r.analyticsOptions.advanced_disable_flags, true);
  assert.equal(r.analyticsOptions.ip, false);
});

test("route templates remove identifiers and only registered screens are sent", async () => {
  const r = runtime();
  const a = r.load("analytics");
  const routes = r.load("routes");
  assert.equal(
    routes.pageTemplate("/businesses/private-business/chat"),
    "/businesses/[businessId]/chat",
  );
  assert.equal(
    routes.pageTemplate("/marketplace/create"),
    "/marketplace/create",
  );
  for (const value of ["/unknown/path", "/home?token=secret", "/home#private"])
    assert.equal(routes.pageTemplate(value), null);
  await a.trackWebPage("/posts/private-one");
  await a.trackWebPage("/posts/private-two");
  await a.trackWebPage("/unknown/path");
  assert.equal(r.calls.filter(([n]) => n === "capture").length, 2);
  assert.ok(!JSON.stringify(r.calls).includes("private-"));
  const registered = readdirSync("src/app", { recursive: true })
    .filter((f) => f.endsWith("page.tsx"))
    .map(
      (f) =>
        "/" +
        f
          .split(path.sep)
          .slice(0, -1)
          .filter((p) => !p.startsWith("("))
          .join("/"),
    );
  assert.deepEqual(
    [...new Set(registered)].sort(),
    [...routes.pageRoutes].sort(),
    "update routes when adding a page",
  );
});

test("PostHog payload scrubbing drops private properties and unexpected events", async () => {
  const r = runtime();
  await r.load("analytics").initializeWebAnalytics();
  const scrub = r.analyticsOptions.before_send;
  const event = scrub({
    event: "$pageview",
    properties: {
      distinct_id: A,
      $pathname: "/messages/[convId]",
      $current_url: "https://test/messages/private?token=secret",
      $referrer: "secret",
      email: "private@example.com",
      message: "private",
      app_environment: "preview",
      $set: { name: "private" },
    },
    $set: { email: "private" },
    $set_once: { name: "private" },
  });
  assert.equal(
    event.properties.$current_url,
    "https://app.yrdly.ng/messages/[convId]",
  );
  assert.equal(event.properties.distinct_id, A);
  assert.equal(
    event.properties.token,
    "phc_fixture",
    "privacy filter preserves the configured public ingestion token",
  );
  assert.equal(event.properties.app_environment, "preview");
  assert.ok(!JSON.stringify(event).includes("private"));
  assert.equal(scrub({ event: "$autocapture", properties: {} }), null);
  assert.equal(
    scrub({
      event: "$pageview",
      properties: { $pathname: "/messages/private" },
    }),
    null,
  );
});

test("Sentry covers all runtimes, excludes request/user data on server, and preserves debug IDs", () => {
  const r = runtime();
  const s = r.load("sentry");
  s.initializeWebSentry("nodejs");
  s.initializeWebSentry("nodejs");
  assert.equal(r.calls.filter(([n]) => n === "sentry.init").length, 1);
  assert.equal(r.sentryOptions.dataCollection.httpHeaders, false);
  assert.equal(r.sentryOptions.tracesSampleRate, undefined);
  assert.equal(r.sentryOptions.maxBreadcrumbs, 0);
  assert.equal(r.sentryOptions.beforeSendTransaction({}), null);
  const event = {
    request: { headers: { authorization: "private" }, url: "private" },
    extra: { message: "private" },
    contexts: { private: true },
    breadcrumbs: [{ message: "private" }],
    user: { id: A, email: "private" },
    tags: {
      operation: "chat.send",
      error_code: "PGRST204",
      private: "private",
    },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "private content",
          stacktrace: {
            frames: [
              {
                filename:
                  "https://app.yrdly.ng/_next/static/chunks/app.js?token=private",
                lineno: 8,
                colno: 3,
                vars: { private: true },
              },
            ],
          },
        },
      ],
    },
    debug_meta: {
      images: [
        {
          type: "sourcemap",
          debug_id: "debug-fixture",
          code_file:
            "https://app.yrdly.ng/_next/static/chunks/app.js?token=private",
        },
      ],
    },
  };
  const safe = r.sentryOptions.beforeSend(event);
  assert.ok(!JSON.stringify(safe).includes("private"));
  assert.equal(safe.user, undefined);
  assert.equal(
    safe.exception.values[0].stacktrace.frames[0].filename,
    safe.debug_meta.images[0].code_file,
  );
  assert.equal(safe.debug_meta.images[0].debug_id, "debug-fixture");
  assert.equal(safe.tags.error_code, "PGRST204");
  const b = runtime();
  const bs = b.load("sentry");
  bs.initializeWebSentry("browser");
  bs.setWebUser(A);
  bs.setWebUser(null);
  assert.deepEqual(
    b.calls.filter(([n]) => n === "user"),
    [
      ["user", null],
      ["user", { id: A }],
      ["user", null],
    ],
  );
  assert.deepEqual(b.sentryOptions.beforeSend(event).user, { id: A });
});

test("handled error bridge sends bounded context and never forwards database payloads", () => {
  const r = runtime();
  const s = r.load("sentry");
  s.initializeWebSentry("browser");
  s.captureWebError(
    { code: "PGRST204", message: "private SQL body" },
    { operation: "chat.send" },
  );
  const [, error, context] = r.calls.find(([n]) => n === "exception");
  assert.ok(error instanceof Error);
  assert.deepEqual(context, {
    tags: { operation: "chat.send", error_code: "PGRST204" },
  });
  assert.ok(!error.message.includes("private"));
});

test("SDK failures cannot break actions or error handling", async () => {
  const r = runtime({ fail: true });
  const s = r.load("sentry");
  s.initializeWebSentry("browser");
  s.setWebUser(A);
  s.captureWebError(new Error("private"));
  const a = r.load("analytics");
  await a.trackWebPage("/home");
  a.setWebAnalyticsUser(A);
  await a.trackWebEvent("business_saved");
});
