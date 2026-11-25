const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadAdminClient() {
  const source = fs.readFileSync('src/lib/supabase/supabase-admin.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  let created = 0;
  const fakeClient = {
    from: (table) => ({ table, marker: 'admin-client' }),
    rpc: (name) => ({ name, marker: 'admin-client' }),
  };
  new Function('require', 'module', 'exports', outputText)((name) => {
    if (name === 'server-only') return {};
    if (name === './supabase-url') return { brandedSupabaseUrl: (url) => url };
    if (name === '@supabase/supabase-js') return { createClient: () => { created++; return fakeClient; } };
    throw new Error('Unexpected import: ' + name);
  }, module, module.exports);
  return { client: module.exports.supabaseAdmin, fakeClient, getCreated: () => created };
}

test('admin client import is safe when build-time server credentials are absent', () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const { client, getCreated } = loadAdminClient();
    assert.equal(getCreated(), 0);
    assert.throws(() => client.from('posts'), /Server Supabase configuration is missing/);
    assert.equal(getCreated(), 0);
  } finally {
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
});

test('admin client initializes once on first actual use and binds methods to the client', () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://qa-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'qa-only-placeholder';
  try {
    const { client, fakeClient, getCreated } = loadAdminClient();
    assert.equal(getCreated(), 0);
    assert.deepEqual(client.from('posts'), { table: 'posts', marker: 'admin-client' });
    assert.equal(getCreated(), 1);
    assert.deepEqual(client.rpc('test'), { name: 'test', marker: 'admin-client' });
    assert.equal(getCreated(), 1);
    assert.equal(client.auth, fakeClient.auth);
  } finally {
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
});
