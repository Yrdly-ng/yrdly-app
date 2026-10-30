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
