const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');

function authRuntime(user, profile = { account_kind: 'human' }) {
  let listener;
  let signedOut = 0;
  let activations = 0;
  const session = { user, access_token: 'fixture-token' };
  let currentSession = session;
  const supabase = {
    auth: {
      signUp: async () => ({ data: { user }, error: null }),
      signInWithPassword: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: currentSession }, error: null }),
      signOut: async () => { signedOut++; return { error: null }; },
      onAuthStateChange: (callback) => { listener = callback; return {}; },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }),
  };
  const dependencies = {
    './session-policy': { checkActiveSession: async () => { activations++; return true; }, endRevokedSession: async () => {} },
    './auth-navigation': { safeRelativePath: () => '/' },
    '../supabase/supabase': { supabase },
    'expo-linking': {},
    'expo-web-browser': { maybeCompleteAuthSession() {} },
    'expo-auth-session': { makeRedirectUri: () => '' },
  };
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync('src/lib/auth/auth-service.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', 'console', code)((id) => {
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency: ${id}`);
  }, mod, mod.exports, { error() {} });
  return { service: mod.exports.AuthService, get signedOut() { return signedOut; }, get activations() { return activations; }, supersede: () => { currentSession = { user: { id: 'human' }, access_token: 'new-session' }; }, emit: () => listener('SIGNED_IN', session) };
}
const virtual = { id: 'virtual', app_metadata: { account_kind: 'managed_virtual' }, identities: [{}] };

test('signup cannot return a managed virtual identity for interactive use', async () => {
  const runtime = authRuntime(virtual);
  const result = await runtime.service.signUp('fiction@example.invalid', 'password', 'Fiction');
  assert.equal(result.user, null);
  assert.match(result.error.message, /virtual accounts cannot sign in/i);
  assert.equal(runtime.signedOut, 1);
});

test('managed virtual password login is rejected before session activation', async () => {
  const runtime = authRuntime(virtual);
  const result = await runtime.service.signIn('fiction@example.invalid', 'password');
  assert.equal(result.user, null);
  assert.match(result.error.message, /virtual accounts cannot sign in/i);
  assert.equal(runtime.signedOut, 1);
  assert.equal(runtime.activations, 0);
});

test('a registry-classified virtual profile cannot sign in even without a metadata marker', async () => {
  const runtime = authRuntime({ id: 'virtual', app_metadata: {} }, { account_kind: 'managed_virtual' });
  const result = await runtime.service.signIn('fiction@example.invalid', 'password');
  assert.equal(result.user, null);
  assert.equal(runtime.signedOut, 1);
});

test('human authentication ignores user-editable account classification', async () => {
  const user = { id: 'human', app_metadata: {}, user_metadata: { account_kind: 'managed_virtual' } };
  const runtime = authRuntime(user);
  const result = await runtime.service.signIn('human@example.invalid', 'password');
  assert.equal(result.user.id, 'human');
  assert.equal(result.error, null);
  assert.equal(runtime.signedOut, 0);
});

test('managed sessions cannot restore an interactive user', async () => {
  const runtime = authRuntime(virtual);
  assert.equal(await runtime.service.getCurrentUser(), null);
  assert.equal(runtime.signedOut, 1);
  assert.equal(runtime.activations, 0);
});

test('virtual session callbacks expose signed-out state before activity can start', async () => {
  const runtime = authRuntime(virtual);
  let timeout;
  const result = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Auth callback did not complete')), 2000);
    runtime.service.onAuthStateChange((...args) => resolve(args));
  });
  runtime.emit();
  try {
    const args = await result;
    assert.equal(args.length === 1 ? args[0] : args[1], null);
    assert.equal(runtime.signedOut, 1);
    assert.equal(runtime.activations, 0);
  } finally { clearTimeout(timeout); }
});

test('virtual identities cannot enter ordinary profile creation', async () => {
  const runtime = authRuntime(virtual);
  await assert.rejects(() => runtime.service.createUserProfile(virtual, 'Fiction'), /virtual accounts cannot sign in/i);
});

test('a delayed virtual callback cannot sign out a newer human session', async () => {
  const runtime = authRuntime(virtual);
  let callbacks = 0;
  runtime.service.onAuthStateChange(() => { callbacks++; });
  runtime.emit();
  runtime.supersede();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(runtime.signedOut, 0);
  assert.equal(callbacks, 0);
});
