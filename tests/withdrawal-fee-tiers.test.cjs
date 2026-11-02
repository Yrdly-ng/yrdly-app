const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(failure, lowFee = 10.75, highFee = 107.50) {
  const calls = [], intents = new Map();
  let savedReference;
  function load(file) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      module, exports: module.exports, AbortSignal, Response,
      console: { log() {}, warn() {}, error() {} },
      process: { env: { PAYLUK_SECRET_KEY: 'sk_test_fixture', PAYLUK_BASE_URL: 'https://payluk.invalid' } },
      require(id) {
        if (id === './payluk-onboarding') return {};
        return load(path.resolve(path.dirname(file), `${id}.ts`));
      },
      async fetch(url, options) {
        assert.equal(new URL(url).origin, 'https://payluk.invalid');
        const endpoint = new URL(url).pathname;
        const body = options.body ? JSON.parse(options.body) : undefined;
        calls.push({ endpoint, body });
        const response = (data, status = 200, message = 'OK') => Response.json(
          { status, message, data }, { status, headers: { 'Retry-After': '37' } },
        );
        if (endpoint.endsWith('/bank-list')) return response([{ code: 'fixture-bank' }]);
        if (endpoint === '/v1/wallet') return response({ mainBalance: 7125, escrowBalance: 0 });
        assert.equal(options.headers['customer-id'], 'fixture-seller');
        if (endpoint.endsWith('/create-intent')) {
          const attempt = calls.filter(call => call.endpoint.endsWith('/create-intent')).length;
          if (attempt === 3 && failure && failure !== 'wallet-race') {
            if (failure === 'network') throw new TypeError('fetch failed');
            return response({}, failure, failure === 400 ? 'Invalid account' : 'Unavailable');
          }
          const fee = body.amount <= 5000 ? lowFee : highFee;
          if ((failure === 'wallet-race' && attempt > 1) || body.amount + fee > 7125) {
            return response({}, 400, 'Insufficient balance');
          }
          const intent = { amount: body.amount, fee, reference: body.reference };
          intents.set(body.reference, intent);
          return response(intent);
        }
        assert.equal(endpoint, '/v1/payment/verify');
        assert.equal(body.reference, savedReference, 'Persist the final quoted intent before verification');
        const intent = intents.get(body.reference);
        assert.equal(intent.amount + intent.fee, 7125);
        return response({ status: 'success' });
      },
    });
    return module.exports;
  }
  const service = load(path.resolve('src/lib/payments/payluk-service.ts')).PaylukService;
  return {
    calls,
    run: mode => service[mode]({
      sellerPaylukCustomerId: 'fixture-seller', amount: 7125, yrdlyAvailableBalance: 7125,
      bankCode: 'fixture-bank', accountNumber: '0000000000', reference: 'fixture-budget',
      onIntentReady: async reference => { savedReference = reference; },
    }),
  };
}

for (const mode of ['previewWithdrawal', 'withdrawToBank']) {
  test(`${mode} quotes a full NGN7125 balance across the NGN5000 fee boundary`, async () => {
    const h = fixture();
    const result = await h.run(mode);
    assert.equal(result.success, true);
    assert.equal(result.intentAmount, 7017.50);
    assert.equal(result.intentFee, 107.50);
    assert.equal(result.totalPaylukDebit, 7125);
    const intents = h.calls.filter(call => call.endpoint.endsWith('/create-intent'));
    assert.deepEqual(intents.map(call => call.body.amount), [1000, 7114.25, 4057.12, 5585.68, 7017.50]);
    assert.equal(new Set(intents.map(call => call.body.reference)).size, intents.length);
    assert.equal(h.calls.filter(call => call.endpoint.endsWith('/verify')).length, mode === 'withdrawToBank' ? 1 : 0);
    // Execution leaves one call for identity validation: nine total, below ten/key/minute.
    assert.equal(h.calls.length, mode === 'withdrawToBank' ? 8 : 6);
  });

  for (const failure of [400, 429, 503, 'network', 'wallet-race']) {
    test(`${mode} stops safely on ${failure} during fee discovery`, async () => {
      const h = fixture(failure);
      const result = await h.run(mode);
      assert.equal(result.success, false);
      assert.equal(h.calls.filter(call => call.endpoint.endsWith('/verify')).length, 0);
      const intents = h.calls.filter(call => call.endpoint.endsWith('/create-intent'));
      assert.equal(intents.length, failure === 'wallet-race' ? 5 : 3);
      if (failure === 429) {
        assert.equal(result.retryAfterSeconds, 37);
        assert.match(result.error, /Wait 37 seconds/);
      }
      if (failure === 'wallet-race') assert.match(result.error, /could not confirm.*fee/i);
    });
  }
}

for(const mode of ['previewWithdrawal','withdrawToBank']) test(`${mode} uses the actual provider fee from the older merchant fee schedule`,async()=>{
 const h=fixture(undefined,10.01,100.10);const result=await h.run(mode);assert.equal(result.success,true);assert.equal(result.intentFee,100.10);assert.equal(result.intentAmount,7024.90);assert.equal(result.totalPaylukDebit,7125);assert.equal(h.calls.filter(c=>c.endpoint.endsWith('/verify')).length,mode==='withdrawToBank'?1:0);
});
