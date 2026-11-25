const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadRoute() {
  const source = fs.readFileSync('src/app/api/crisp/identity/route.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)((name) => {
    if (name === 'node:crypto') return { createHmac: () => ({ update: () => ({ digest: () => 'signature' }) }) };
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name === '@/lib/supabase/supabase-server') return {
      getAuthenticatedUser: async () => ({ data: { user: { email: 'verified@example.test', email_confirmed_at: '2026-01-01' } }, error: null }),
    };
    throw new Error('Unexpected import: ' + name);
  }, module, module.exports);
  return module.exports;
}

test('missing Crisp identity secret is a non-fatal optional feature and logs a warning once', async () => {
  const secret = process.env.CRISP_IDENTITY_SECRET;
  delete process.env.CRISP_IDENTITY_SECRET;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const { GET } = loadRoute();
    for (let i = 0; i < 2; i++) {
      const response = await GET(new Request('https://fixture.invalid/api/crisp/identity'));
      assert.equal(response.status, 503);
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /CRISP_IDENTITY_SECRET is not configured/);
  } finally {
    console.warn = originalWarn;
    if (secret === undefined) delete process.env.CRISP_IDENTITY_SECRET;
    else process.env.CRISP_IDENTITY_SECRET = secret;
  }
});
