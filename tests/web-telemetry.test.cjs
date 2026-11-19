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
function runtime({ config = env, browser = true, fail = false, failReset = false } = {}) {
  const calls = [];
  const breadcrumbs = [];
  const tags = {};
  let analyticsOptions;
  let sentryOptions;
  const call = (name, ...args) => {
    calls.push([name, ...args]);
    if (fail) throw new Error("offline");
  };
  const replayTransitions = [];
  const ph = {
    startSessionRecording: () => replayTransitions.push("start"),
    stopSessionRecording: () => replayTransitions.push("stop"),
    captureException: (...args) => call("ph.exception", ...args),
    init(key, options) {
      call("ph.init", key);
      analyticsOptions = options;
    },
    identify: (id) => call("identify", id),
    reset: (flag) => {
      call("reset", flag);
      if (failReset) throw new Error('reset unavailable');
    },
    capture: (...args) => call("capture", ...args),
  };
  const sentry = {
    addBreadcrumb(crumb) {
      const safe = sentryOptions.beforeBreadcrumb(crumb);
      if (safe) breadcrumbs.push(safe);
      if (breadcrumbs.length > 20) breadcrumbs.shift();
    },
    getCurrentScope() { return { clearBreadcrumbs: () => { breadcrumbs.length = 0; } }; },
    setTag(name, value) { tags[name] = value; },
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
    if (file.endsWith(".json")) return require(file);
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
        if (id === "@/lib/attribution/signup") return load(path.resolve("src/lib/attribution/signup.ts"));
        if (id === "@sentry/nextjs") return sentry;
        assert.ok(id.startsWith("."));
        return load(path.resolve(path.dirname(file), id.endsWith(".json") ? id : id + ".ts"));
      },
      module,
      module.exports,
      { env: config },
      browser === true ? {} : browser || undefined,
    );
    return module.exports;
  }
  return {
    load: (name) => load(path.resolve("src/lib/telemetry", name + ".ts")),
    calls,
    breadcrumbs,
    tags,
    replayTransitions,
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
  assert.equal(r.analyticsOptions.advanced_disable_flags, false);
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

test("ad campaign labels survive pageview scrubbing without raw URLs or click IDs", async () => {
  const r = runtime();
  await r.load("analytics").initializeWebAnalytics();
  const safe = r.analyticsOptions.before_send({
    event: "$pageview",
    properties: {
      $pathname: "/home",
      $utm_source: "tiktok",
      $utm_medium: "paid_social",
      $utm_campaign: "traffic_1",
      $utm_content: "not_allowed",
      $utm_term: "secret",
      $current_url: "https://app.yrdly.ng/home?gclid=private-click",
      email: "private@example.com",
    },
  });
  assert.equal(safe.properties.$utm_source, "tiktok");
  assert.equal(safe.properties.$utm_medium, "paid_social");
  assert.equal(safe.properties.$utm_campaign, "traffic_1");
  assert.equal(safe.properties.$utm_term, undefined);
  assert.equal(safe.properties.$utm_content, undefined);
  assert.equal(safe.properties.$current_url, "https://app.yrdly.ng/home");
  assert.doesNotMatch(JSON.stringify(safe), /private|secret|gclid|example\\.com/);
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

test('Sentry preserves safe runtime categories without forwarding the original error payload', () => {
  const r = runtime();
  r.load('sentry').initializeWebSentry('browser');
  const cases = [
    ['Maximum call stack size exceeded', 'JavaScript stack overflow'],
    ["Cannot read properties of undefined (reading 'private')", 'Undefined property access'],
    ["Cannot read properties of null (reading 'private')", 'Null property access'],
    ['Loading chunk 123 failed. (https://private.invalid/token)', 'Application chunk unavailable'],
    ['Minified React error #185; visit https://private.invalid/?args=private', 'React runtime error #185'],
    ['Google Maps JavaScript API error: RefererNotAllowedMapError https://private.invalid', 'Google Maps referrer rejected'],
  ];
  for (const [value, category] of cases) {
    const event = { exception: { values: [{ type: 'Error', value }] } };
    const safe = r.sentryOptions.beforeSend(event);
    assert.equal(safe.exception.values[0].value, category);
    assert.equal(r.sentryOptions.beforeSend(safe).exception.values[0].value, category);
    assert.ok(!JSON.stringify(safe).includes('private'));
  }
  r.load('sentry').captureWebError({ message: 'Loading chunk 123 failed. https://private.invalid' });
  assert.equal(r.calls.find(([name]) => name === 'exception')[1].message, 'Application chunk unavailable');
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

test("PostHog records masked public routes and stops on payment, chat and account pages", async () => {
 const r=runtime();const analytics=r.load('analytics');await analytics.trackWebPage('/events');
 assert.ok(r.replayTransitions.includes('start'));
 const recording=r.analyticsOptions.session_recording;
 assert.equal(recording.maskAllInputs,true);assert.equal(recording.maskTextSelector,'*');assert.equal(recording.maskAllElementAttributes,true);
 assert.equal(recording.recordBody,false);assert.equal(recording.recordHeaders,false);assert.equal(recording.maskCapturedNetworkRequestFn({url:'private'}),null);
 await analytics.trackWebPage('/messages/private-id');assert.equal(r.replayTransitions.at(-1),'stop');
 await analytics.trackWebPage('/payment/success');assert.equal(r.replayTransitions.at(-1),'stop');
 for (const path of ['/businesses/private-id/chat', '/businesses/private-id/bookings', '/unregistered-private']) {
  await analytics.trackWebPage('/events');assert.equal(r.replayTransitions.at(-1),'start');
  await analytics.trackWebPage(path);assert.equal(r.replayTransitions.at(-1),'stop');
 }
});
test("PostHog safe exceptions and masked snapshots survive the privacy filter without other properties",async()=>{
 const r=runtime();await r.load('analytics').initializeWebAnalytics();const filter=r.analyticsOptions.before_send;
 const error=filter({event:'$exception',properties:{$exception_list:[{type:'Error',value:'private user account',stacktrace:{frames:[{vars:{secret:'private'}}]}}],email:'private'}});
 assert.ok(error);assert.doesNotMatch(JSON.stringify(error),/private|secret/);assert.equal(error.properties.$exception_list[0].value,'Application operation failed');
 const snapshot=filter({event:'$snapshot',properties:{$snapshot_data:[{type:3,data:{x:1}}],$session_id:'session',email:'private'}});
 assert.deepEqual(snapshot.properties.$snapshot_data,[{type:3,data:{x:1}}]);assert.doesNotMatch(JSON.stringify(snapshot),/private/);
 const metadata=filter({event:'$snapshot',properties:{$snapshot_data:[{type:4,data:{href:'https://app.yrdly.ng/private?secret=private',width:390,height:800}},{type:5,data:{secret:'private'}},{type:6,data:{secret:'private'}}]}});
 assert.equal(metadata.properties.$snapshot_data.length,1);assert.equal(metadata.properties.$snapshot_data[0].data.href,'https://app.yrdly.ng/');assert.doesNotMatch(JSON.stringify(metadata),/private/);
});

test("injected-only browser errors are filtered while mixed application stacks stay visible",()=>{
 const r=runtime();r.load('sentry').initializeWebSentry('browser');
 const event={exception:{values:[{type:'Error',value:'private',stacktrace:{frames:[{filename:'app:///scripts/inpage.js'}]}}]}};
 assert.equal(r.sentryOptions.beforeSend(event),null);
 event.exception.values[0].stacktrace.frames.push({filename:'app:///_next/static/chunks/app.js',in_app:true});
 assert.ok(r.sentryOptions.beforeSend(event));
});


test("analytics keeps safe device fields and only the current account's selected state", async () => {
  const r = runtime();
  const a = r.load('analytics');
  a.setWebAnalyticsUser(A, 'Lagos');
  await a.trackWebPage('/home');
  let payload = r.calls.filter(([name]) => name === 'capture').at(-1)[2];
  assert.equal(payload.home_state, 'Lagos');
  const safe = r.analyticsOptions.before_send({ event: '$pageview', properties: {
    ...payload, $pathname: '/home', $is_identified: true,
    $browser: 'Mobile Safari', $browser_version: 18.1, $os: 'iOS', $device_type: 'Mobile',
    address: 'private', latitude: 6.1, longitude: 3.1,
  }});
  assert.equal(safe.properties.home_state, 'Lagos');
  assert.equal(safe.properties.$browser, 'Mobile Safari');
  assert.equal(safe.properties.$device_type, 'Mobile');
  assert.equal(safe.properties.latitude, undefined);
  assert.equal(safe.properties.address, undefined);
  a.setWebAnalyticsUser(B);
  await a.trackWebEvent('business_saved');
  payload = r.calls.filter(([name]) => name === 'capture').at(-1)[2];
  assert.equal(payload.home_state, null);
  a.setWebAnalyticsUser(B, 'private address');
  await a.trackWebEvent('business_saved');
  assert.equal(r.calls.filter(([name]) => name === 'capture').at(-1)[2].home_state, null);
  a.setWebAnalyticsUser(null, 'Ogun');
  await a.trackWebEvent('business_saved');
  assert.equal(r.calls.filter(([name]) => name === 'capture').at(-1)[2].home_state, null);
  assert.equal(r.load('metadata').homeState('fct'), 'Federal Capital Territory');
  assert.equal(r.load('metadata').homeState('Nassarawa'), 'Nasarawa');
});

test('failed identity reset cannot attribute another account state or activity to the old user', async () => {
  const r = runtime({ failReset: true });
  const a = r.load('analytics');
  a.setWebAnalyticsUser(A, 'Lagos');
  await a.trackWebPage('/home');
  a.setWebAnalyticsUser(B, 'Ogun');
  await a.trackWebEvent('business_saved');
  await a.trackWebPage('/explore');
  assert.equal(r.calls.filter(([name]) => name === 'capture').length, 1);
  assert.deepEqual(r.calls.filter(([name]) => name === 'identify'), [['identify', A]]);
});

test('async initialization uses the latest account state and counts same-route account switches', async () => {
  const r = runtime();
  const a = r.load('analytics');
  a.setWebAnalyticsUser(A, 'Lagos');
  const pending = a.initializeWebAnalytics();
  a.setWebAnalyticsUser(B, 'Ogun');
  await pending;
  await a.trackWebPage('/home');
  a.setWebAnalyticsUser(A, 'Lagos');
  await a.trackWebPage('/home');
  const states = r.calls.filter(([name]) => name === 'capture').map(([, , properties]) => properties.home_state);
  assert.deepEqual(states, ['Ogun', 'Lagos']);
});

test("activation events are identifiable, privacy-safe and include only bounded action categories", async () => {
  const r = runtime();
  const analytics = r.load("analytics");
  await analytics.trackWebActivationEvent("onboarding_active_visit");
  assert.equal(r.calls.filter(([name]) => name === "capture").length, 0, "anonymous visits are excluded");
  analytics.setWebAnalyticsUser(A);
  await analytics.trackWebActivationEvent("onboarding_profile_completed");
  await analytics.trackWebActivationEvent("onboarding_home_reached");
  await analytics.trackWebActivationEvent("onboarding_meaningful_action", "community_post");
  await analytics.trackWebActivationEvent("onboarding_meaningful_action", "business_message");
  await analytics.trackWebActivationEvent("onboarding_active_visit");
  const captures = r.calls.filter(([name]) => name === "capture");
  assert.deepEqual(captures.map(([, event]) => event), [
    "onboarding_profile_completed", "onboarding_home_reached",
    "onboarding_meaningful_action", "onboarding_meaningful_action", "onboarding_active_visit",
  ]);
  const scrub = r.analyticsOptions.before_send;
  const permitted = scrub({ event: "onboarding_meaningful_action", properties: {
    distinct_id: A, action_type: "community_post", email: "private@example.com",
    location: "private", message: "private", $current_url: "private",
  } });
  assert.equal(permitted.properties.action_type, "community_post");
  assert.ok(!JSON.stringify(permitted).includes("private"));
  const rejected = scrub({ event: "onboarding_meaningful_action", properties: {
    action_type: "unrecognized", email: "private@example.com",
  } });
  assert.equal(rejected.properties.action_type, undefined);
  assert.equal(scrub({event:"unknown_funnel_event",properties:{}}),null);
});


test("account-created analytics preserves campaign dimensions but never private URL data", async () => {
  const r = runtime();
  const analytics = r.load("analytics");
  await analytics.trackWebAccountCreated(A, {
    version: 1,
    first: { source: "instagram", medium: "social", campaign: "profile_bio" },
    last: { source: "google", medium: "cpc", campaign: "november_ads" },
    captured_at: "2026-11-13T00:00:00Z",
  });
  assert.ok(r.calls.some(([name, id]) => name === "identify" && id === A));
  const [, eventName, payload] = r.calls.find(([name, event]) =>
    name === "capture" && event === "account_created");
  assert.equal(eventName, "account_created");
  assert.equal(payload.acquisition_first_source, "instagram");
  assert.equal(payload.acquisition_last_campaign, "november_ads");
  const sanitized = r.analyticsOptions.before_send({
    event: "account_created",
    properties: {
      ...payload,
      email: "someone@example.com",
      $current_url: "https://app.yrdly.ng/login?password=secret",
      gclid: "private-click-id",
      $set: { phone: "secret" },
      acquisition_first_source: "alice@example.com",
    },
  });
  assert.ok(sanitized);
  assert.equal(sanitized.properties.acquisition_first_source, undefined);
  assert.equal(sanitized.properties.acquisition_last_source, "google");
  assert.equal(sanitized.properties.signup_method, "email");
  assert.doesNotMatch(JSON.stringify(sanitized), /example\.com|password|private-click-id|phone|secret/);
});

test("successful business registrations use the newsletter campaign without exposing profile data", async () => {
  const attribution = {
    version: 1,
    first: { source: "yrdly_newsletter", medium: "email", campaign: "small_businesses_spotlight" },
    last: { source: "yrdly_newsletter", medium: "email", campaign: "small_businesses_spotlight" },
    captured_at: new Date().toISOString(),
  };
  const r = runtime({ browser: { sessionStorage: { getItem: () => JSON.stringify(attribution) } } });
  const analytics = r.load("analytics");
  analytics.setWebAnalyticsUser(A);
  await analytics.trackWebBusinessProfileCreated(B);
  await analytics.trackWebBusinessProfileCreated(A);
  const conversions = r.calls.filter(([method, event]) =>
    method === "capture" && event === "business_profile_created");
  assert.equal(conversions.length, 1);
  const permitted = r.analyticsOptions.before_send({
    event: "business_profile_created",
    properties: {
      ...conversions[0][2],
      business_name: "Private business",
      email: "private@example.com",
      $current_url: "https://app.yrdly.ng/businesses?private=data",
      signup_method: "email",
    },
  });
  assert.equal(permitted.properties.acquisition_last_campaign, "small_businesses_spotlight");
  assert.equal(permitted.properties.acquisition_last_medium, "email");
  assert.doesNotMatch(JSON.stringify(permitted), /Private business|example\.com|private=data|signup_method/);
});

test("only a successful business insert triggers registration tracking", () => {
  const source = readFileSync("src/hooks/use-posts.tsx", "utf8");
  const registration = source.slice(source.indexOf("const createBusiness ="), source.indexOf("const deletePost ="));
  const insert = registration.indexOf(".insert(");
  const success = registration.indexOf("savedBusinessId = createdBusiness.id;");
  const event = registration.indexOf("void trackWebBusinessProfileCreated(user.id);");
  assert.notEqual(insert, -1);
  assert.ok(success > insert && event > success);
  assert.equal(registration.match(/trackWebBusinessProfileCreated\(user.id\)/g)?.length, 1);
});

test('manual diagnostic breadcrumbs contain templates and fixed actions, and reset when identity changes', async () => {
  const r=runtime();const s=r.load('sentry'),a=r.load('analytics');s.initializeWebSentry('browser');
  s.setWebUser(A);s.setWebScreen('/marketplace/private-item');await a.trackWebEvent('ticket_checkout_started');
  s.reportWebRecoveryRequested();
  assert.deepEqual(r.breadcrumbs.map(b=>b.category),['app.navigation','app.action','app.recovery']);
  assert.equal(r.tags.screen,'/marketplace/[itemId]');
  const safe=r.sentryOptions.beforeSend({tags:{...r.tags,app_state:'active'},breadcrumbs:[...r.breadcrumbs,{category:'fetch',message:'private',data:{token:'private'}}],exception:{values:[{type:'TypeError',value:'Cannot read properties of null',mechanism:{handled:false,type:'generic'}}]}});
  assert.equal(safe.breadcrumbs.length,3);assert.equal(safe.tags.screen,'/marketplace/[itemId]');
  assert.ok(!JSON.stringify(safe).includes('private'));
  await new Promise(resolve=>setImmediate(resolve));
  const metric=r.calls.find(c=>c[0]==='capture'&&c[1]==='app_error');
  assert.equal(metric[2].handled,false);assert.equal(metric[2].error_category,'Null property access');
  s.setWebUser(B);assert.equal(r.breadcrumbs.length,0);
});

test('reliability analytics keep release/screen/category but drop raw routes, arbitrary events and payloads', async () => {
  const r=runtime({config:{...env,NEXT_PUBLIC_APP_RELEASE:'abcdef0123456789'}});const a=r.load('analytics');
  await a.trackWebReliability('app_error',{screen:'/messages/private',error_category:'private',error_type:'private',operation:'private',token:'private',url:'private'});
  const metric=r.calls.find(c=>c[0]==='capture');
  const safe=r.analyticsOptions.before_send({event:metric[1],properties:{...metric[2],private:'private'}});
  assert.equal(safe.properties.app_release,'abcdef0123456789');assert.equal(safe.properties.error_category,'Application operation failed');
  assert.equal(safe.properties.screen,undefined);assert.ok(!JSON.stringify(safe).includes('private'));
  const count=r.calls.length;await a.trackWebReliability('private',{message:'private'});assert.equal(r.calls.length,count);
});

test('server events cannot inherit browser diagnostic breadcrumbs or route state', () => {
  const r=runtime({browser:false});r.load('sentry').initializeWebSentry('nodejs');
  const safe=r.sentryOptions.beforeSend({tags:{screen:'/map',app_state:'active'},breadcrumbs:[{category:'app.navigation',message:'/map'}]});
  assert.equal(safe.tags.screen,undefined);assert.equal(safe.breadcrumbs,undefined);
});

test('an account switch during async analytics initialization drops the prior account reliability event', async()=>{
 const r=runtime();const a=r.load('analytics');a.setWebAnalyticsUser(A);
 const pending=a.trackWebReliability('app_error',{screen:'/marketplace',error_category:'Operation timed out'});
 a.setWebAnalyticsUser(B);await pending;
 assert.ok(!r.calls.some(c=>c[0]==='capture'&&c[1]==='app_error'));
});

test('app launch is counted once after the authenticated analytics identity has settled', async()=>{
 const r=runtime();const a=r.load('analytics'),s=r.load('sentry');
 a.setWebAnalyticsUser(A);s.reportWebAppStarted();s.reportWebAppStarted();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.calls.filter(c=>c[0]==='capture'&&c[1]==='app_started').length,1);
});
