const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (id === 'server-only') return {};
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`), mocks);
    return require(id);
  };
  vm.runInNewContext(output, { module, exports: module.exports, require: localRequire,
    console, AbortSignal, Response, URL, URLSearchParams, Buffer, setTimeout, clearTimeout,
    process: { env: { PAYLUK_SECRET_KEY: 'test-only', ...mocks.env } },
    fetch: mocks.fetch || (() => { throw new Error('Live network is prohibited in audit tests'); }),
  }, { filename });
  return module.exports;
}

function chain(result) {
  const query = {};
  for (const method of ['select','eq','neq','is','in','or','limit','update','insert','single','maybeSingle']) query[method] = () => query;
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

test('onboarding rejects an unverified phone before calling Payluk', async () => {
  const { ensurePaylukCustomer } = load('src/lib/payluk-onboarding.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => chain({ data: { phone: '08012345678', phone_verified: false } }) } },
    './payluk-service': { PaylukService: {} },
  });
  await assert.rejects(ensurePaylukCustomer('buyer'), /Verify your phone/);
});

test('stored Payluk identity with a different phone is rejected without remapping', async () => {
  let reads = 0;
  const { ensurePaylukCustomer } = load('src/lib/payluk-onboarding.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => { reads++; return chain({ data: { phone: '08012345678', phone_verified: true, payluk_customer_id: 'existing' } }); } } },
    './payluk-service': { PaylukService: { getCustomerById: async () => ({ customerId: 'existing', phone: '08098765432' }) } },
  });
  await assert.rejects(ensurePaylukCustomer('buyer'), /identity could not be verified/);
  assert.equal(reads, 1);
});

test('Payluk mapping held by another Yrdly user is rejected', async () => {
  let reads = 0;
  const { ensurePaylukCustomer } = load('src/lib/payluk-onboarding.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => chain({ data: ++reads === 1
      ? { phone: '08012345678', phone_verified: true, payluk_customer_id: 'existing' } : [{ id: 'other' }] }) } },
    './payluk-service': { PaylukService: { getCustomerById: async () => ({ customerId: 'existing', phone: '+2348012345678' }) } },
  });
  await assert.rejects(ensurePaylukCustomer('buyer'), /already linked/);
});

test('escrow transition refuses another seller', async () => {
  const { POST } = load('src/app/api/transactions/[id]/status/route.ts', {
    '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'outsider' } } }) },
    '@/lib/supabase-admin': { supabaseAdmin: { from: () => chain({ data: { buyer_id: 'buyer', seller_id: 'seller', status: 'paid' } }) } },
  });
  const result = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ action: 'shipped' }) }), { params: Promise.resolve({ id: 'tx' }) });
  assert.equal(result.status, 403);
});

test('payout accounts enforce verification and cooling period', () => {
  const { payoutAccountError } = load('src/lib/payout-account.ts');
  assert.match(payoutAccountError({ is_active: true, verification_status: 'pending' }), /verified/);
  assert.match(payoutAccountError({ is_active: true, verification_status: 'verified', account_updated_at: new Date().toISOString() }), /24 hours/);
  assert.equal(payoutAccountError({ is_active: true, verification_status: 'verified', account_updated_at: null }), null);
});

module.exports = { load, chain };
