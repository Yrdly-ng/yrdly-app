const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

test('the delivery worker preserves the FCM sender mismatch hidden by Expo’s generic error', async () => {
  let handler;
  const updates = [];
  const delivery = { id: 'delivery', user_id: 'recipient', device_id: 'device', payload: {}, attempt_count: 5,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), provider_ticket_id: 'receipt' };
  const admin = {
    from() {
      const query = {
        update(values) { updates.push(values); return query; },
        select() { return query; }, eq() { return query; }, in() { return query; },
        lte() { return query; }, gt() { return query; }, not() { return query; },
        limit: async () => ({ data: [delivery], error: null }),
        then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
      };
      return query;
    },
    rpc: async () => ({ data: [], error: null }),
  };
  const code = ts.transpileModule(fs.readFileSync('supabase/functions/process-push-notification-outbox/index.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fetch = async url => {
    assert.equal(url, 'https://exp.host/--/api/v2/push/getReceipts', 'receipt diagnosis must not send another alert');
    return Response.json({ data: { receipt: { status: 'error',
      message: 'The request sent to the server was malformed or contained invalid parameters.',
      details: { error: 'DeveloperError', fcm: { httpStatus: 403, response: JSON.stringify({ error: {
        code: 403, message: 'SenderId mismatch', details: [{ errorCode: 'SENDER_ID_MISMATCH' }],
      } }) } },
    } } });
  };
  new Function('require', 'exports', 'Deno', 'fetch', code)(id => id.includes('/http/server')
    ? { serve: callback => { handler = callback; } } : { createClient: () => admin }, {},
  { env: { get: key => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'fixture-key' : key === 'SUPABASE_URL' ? 'https://fixture.invalid' : undefined } }, fetch);
  const response = await handler(new Request('https://fixture.invalid', { method: 'POST', headers: { apikey: 'fixture-key' } }));
  assert.equal(response.status, 200);
  const failure = updates.find(update => update.last_error?.includes('SENDER_ID_MISMATCH'));
  assert.ok(failure, 'Persist the actionable Firebase sender mismatch, rather than only the generic malformed-request text');
  assert.equal(failure.status, 'failed');
});

for (const scenario of [
  { name: 'expired notification still collects an accepted receipt', receipt: { status: 'ok' }, expected: 'delivered' },
  { name: 'expired notification preserves the real provider rejection', receipt: { status: 'error', message: 'Invalid credentials', details: { error: 'InvalidCredentials' } }, expected: 'failed', error: 'Invalid credentials' },
  { name: 'expired notification waits for a missing receipt without resending', expected: 'awaiting_receipt' },
  { name: 'receipt collection stops after 24 hours without claiming device expiry', age: 25, expected: 'failed', error: 'Provider receipt unavailable after 24 hours' },
]) {
  test(scenario.name, async () => {
    let handler;
    const now = Date.now();
    const row = { id: 'expired', user_id: 'recipient', device_id: 'device', payload: {}, attempt_count: 1,
      expires_at: new Date(now - 300_000).toISOString(), last_attempt_at: new Date(now - (scenario.age || 1) * 3600_000).toISOString(),
      provider_ticket_id: 'ticket', status: 'awaiting_receipt', next_attempt_at: new Date(now - 1000).toISOString() };
    const queued = { ...row, id: 'never-sent', status: 'queued', provider_ticket_id: null };
    const rows = [row, queued];
    const admin = { from() {
      const predicates = []; let patch;
      const matches = r => predicates.every(p => p(r));
      const q = {
        update(v) { patch = v; return q; }, select() { return q; },
        eq(k,v) { predicates.push(r => r[k] === v); return q; },
        in(k,vs) { predicates.push(r => vs.includes(r[k])); return q; },
        lte(k,v) { predicates.push(r => r[k] <= v); return q; },
        gt(k,v) { predicates.push(r => r[k] > v); return q; },
        not(k,op,v) { assert.equal(op,'is'); predicates.push(r => r[k] !== v); return q; },
        limit: async n => ({ data: rows.filter(matches).slice(0,n), error: null }),
        then(resolve,reject) { if (patch) for (const r of rows.filter(matches)) Object.assign(r,patch); return Promise.resolve({error:null}).then(resolve,reject); },
      }; return q;
    }, rpc: async () => ({ data: [], error: null }) };
    let requests = 0;
    const fetch = async url => { requests++; assert.equal(url,'https://exp.host/--/api/v2/push/getReceipts'); return Response.json({data: scenario.receipt ? {ticket:scenario.receipt} : {}}); };
    const code = ts.transpileModule(fs.readFileSync('supabase/functions/process-push-notification-outbox/index.ts','utf8'), {
      compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require','exports','Deno','fetch',code)(id => id.includes('/http/server') ? {serve: cb => {handler=cb;}} : {createClient:()=>admin},{},
      {env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'fixture-key':key==='SUPABASE_URL'?'https://fixture.invalid':undefined}},fetch);
    const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{apikey:'fixture-key'}}));
    assert.equal(response.status,200);assert.equal(row.status,scenario.expected);
    assert.equal(queued.status,'failed');assert.equal(queued.last_error,'Notification expired before delivery');
    if(scenario.error) assert.equal(row.last_error,scenario.error);
    assert.equal(requests,scenario.age ? 0 : 1,'Only fetch the receipt; never send the expired notification again');
  });
}
