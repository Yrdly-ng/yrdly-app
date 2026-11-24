const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');

const source = readFileSync('src/lib/onboarding-analytics.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup() {
  const google = [];
  const mixpanel = [];
  const window = {
    location: { href: 'https://app.yrdly.ng/onboarding?code=secret-token#private-fragment' },
    navigator: { userAgent: 'private-agent' },
    gtag: (...args) => google.push(args),
    mixpanel: { track: (...args) => mixpanel.push(args) },
  };
  const module = { exports: {} };
  new Function('exports', 'window', compiled)(module.exports, window);
  return { analytics: module.exports.onboardingAnalytics, google, mixpanel };
}

test('recognized onboarding events retain safe funnel details at both providers', () => {
  const { analytics, google, mixpanel } = setup();
  analytics.trackStepStart('profile_setup');
  analytics.trackStepComplete('profile_setup', { hasUsername: true });
  analytics.track('onboarding_status_updated', { status: 'completed', userId: 'private-id' });
  analytics.trackEmailVerificationCompleted('person@example.com', 'link');
  analytics.trackOnboardingComplete(200, { skipped: true });

  assert.deepEqual(google.map(([, name]) => name), mixpanel.map(([name]) => name));
  assert.equal(google.length, 5);
  for (const details of [google.map(([, , data]) => data), mixpanel.map(([, data]) => data)]) {
    assert.equal(details[0].event_label, 'profile_setup');
    assert.equal(details[1].step, 'profile_setup');
    assert.equal(details[1].hasUsername, true);
    assert.equal(typeof details[1].timeSpent, 'number');
    assert.equal(details[2].status, 'completed');
    assert.equal(details[3].method, 'link');
    assert.equal(details[4].skipped, true);
    assert.equal(details[4].totalTime, 200);
  }
  assert.match(google[0][2].page_location, /^https:\/\/app\.yrdly\.ng\/onboarding$/);
  assert.equal(google[0][2].page_referrer, '');
  assert.equal(mixpanel[0][1].$initial_referrer, '');
  assert.doesNotMatch(JSON.stringify([google, mixpanel]), /private-id|person@example\.com/);
});

test('unknown events and identifying, out-of-range or spoofed fields stay out of analytics', () => {
  const { analytics, google, mixpanel } = setup();
  analytics.track('person@example.com', { status: 'signup' });
  analytics.trackError('person@example.com', 'failed for person@example.com', {
    userId: 'private-id',
    email: 'person@example.com',
    url: 'https://app.yrdly.ng/?email=person@example.com',
    page_location: 'https://app.yrdly.ng/?code=secret-token',
    $current_url: 'https://app.yrdly.ng/?code=secret-token',
    status: 'private-status',
    method: 'private-method',
    totalTime: Infinity,
    timeSpent: -1,
    locationCompleteness: 120,
    totalSteps: 10_000,
    hasLocation: 'yes',
  });

  assert.equal(google.length, 1);
  assert.equal(mixpanel.length, 1);
  for (const data of [google[0][2], mixpanel[0][1]]) {
    assert.equal(data.event_category, 'onboarding');
    for (const key of ['step', 'error', 'status', 'totalTime', 'timeSpent', 'totalSteps', 'locationCompleteness', 'hasLocation']) {
      assert.equal(Object.hasOwn(data, key), false, key);
    }
  }
  assert.doesNotMatch(JSON.stringify([google, mixpanel]), /private-|secret-token|@example\.com/);
});
