const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');

function fixture(initialProfile, readError = null) {
  let profile = initialProfile;
  let created = 0;
  let signedOut = 0;
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test', user_metadata: { name: 'QA Tester' } };
  const supabase = {
    auth: {
      signInWithPassword: async () => ({ data: { user }, error: null }),
      signOut: async () => { signedOut += 1; return { error: null }; },
    },
    from: (table) => {
      assert.equal(table, 'users');
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: readError }) }) }) };
    },
  };
  const compiled = ts.transpileModule(readFileSync('src/lib/auth/auth-service.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const unexpectedSignupTracking = () => { throw new Error('Password sign-in must not create signup attribution or conversion events'); };
  new Function('require','module','exports',compiled)((path) => {
    if (path === '@/lib/attribution/signup') return { signupAttribution: unexpectedSignupTracking, appendOAuthAttribution: unexpectedSignupTracking };
    if (path === '@/lib/telemetry/analytics') return { trackWebAccountCreated: unexpectedSignupTracking };
    if (path === '@/lib/attribution/google-ads') return { reportGoogleAdsSignup: unexpectedSignupTracking };
    if (path === '@/lib/attribution/google-measurement') return { googleTagManagerEnabled: true, reportGoogleConversion: unexpectedSignupTracking };
    if (path === './session-policy') return { checkActiveSession: async () => true, endRevokedSession: async () => {} };
    if (path === './auth-navigation') return { safeRelativePath: (s) => s };
    if (path === '../supabase/supabase') return { supabase };
    throw new Error('Unexpected import: ' + path);
  }, mod, mod.exports);
  mod.exports.AuthService.createUserProfile = async () => {
    created += 1;
    profile = { status: 'active', is_suspended: false, is_banned: false };
  };
  return {
    signIn: () => mod.exports.AuthService.signIn('qa@example.test','test-password'),
    get created() { return created; },
    get signedOut() { return signedOut; },
  };
}

test('a newly verified account gets a profile before login status validation', async () => {
  const r = fixture(null);
  const result = await r.signIn();
  assert.ok(result.user);
  assert.equal(result.error, null);
  assert.equal(r.created, 1);
  assert.equal(r.signedOut, 0);
});

test('suspended profiles are not overwritten or allowed to sign in', async () => {
  const r = fixture({ status: 'suspended', is_suspended: true, is_banned: false });
  const result = await r.signIn();
  assert.equal(result.user, null);
  assert.match(result.error.message, /suspended/i);
  assert.equal(r.created, 0);
  assert.equal(r.signedOut, 1);
});

test('database read failures fail closed without bootstrap', async () => {
  const oldError = console.error;
  console.error = () => {};
  try {
    const r = fixture(null, { code: '42501', message: 'permission denied' });
    const result = await r.signIn();
    assert.equal(result.user, null);
    assert.equal(r.created, 0);
    assert.equal(r.signedOut, 1);
  } finally {
    console.error = oldError;
  }
});

const navigationModule = { exports: {} };
new Function('module','exports',ts.transpileModule(readFileSync('src/lib/auth/auth-navigation.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(navigationModule,navigationModule.exports);
const { loginDestination } = navigationModule.exports;
test('login never treats a missing or stale profile as incomplete onboarding', () => {
  const owner = 'owner';
  assert.equal(loginDestination(owner,null,false,'/home'),null);
  assert.equal(loginDestination(owner,{id:'other',profile_completed:false},false,'/home'),null);
  assert.equal(loginDestination(owner,{id:owner,profile_completed:true},true,'/home'),null);
  assert.equal(loginDestination(owner,{id:owner,profile_completed:null},false,'/home'),null);
  assert.equal(loginDestination(owner,{id:owner,profile_completed:true},false,'/marketplace'),'/marketplace');
  assert.equal(loginDestination(owner,{id:owner,profile_completed:false},false,'/marketplace'),'/onboarding/profile?next=%2Fmarketplace');
  assert.equal(loginDestination(owner,{id:owner,profile_completed:true},false,'//evil.example'),'/home');
});
