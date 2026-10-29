const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function fixture(configured = true) {
  const sent = [];
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('src/lib/email/resend-service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', 'process', source)(name => {
    if (name === 'resend') return { Resend: class { emails = { send: async (...args) => { sent.push(args); return { error: null }; } }; } };
    if (name === './email-templates') return { emailTemplates: {} };
    throw Error(`Unexpected ${name}`);
  }, module, module.exports, { env: { RESEND_API_KEY: configured ? 'fixture' : '', NEXT_PUBLIC_APP_URL: 'https://app.yrdly.ng' } });
  return { sent, send: module.exports.ResendEmailService.sendEventCancellationEmail.bind(module.exports.ResendEmailService) };
}

test('cancellation email uses stable idempotency key, escaped event data and honest refund wording', async () => {
  const f = fixture();
  await f.send('ada@example.com', '<Ada>', '<script>party</script>\r\nHello', '2026-11-01T12:00:00Z', '<Lagos>', 'event-cancellation:delivery-1');
  const [message, options] = f.sent[0];
  assert.equal(options.idempotencyKey, 'event-cancellation:delivery-1');
  assert.match(message.html, /&lt;Ada&gt;/); assert.match(message.html, /&lt;script&gt;/);
  assert.doesNotMatch(message.html, /<script>/); assert.doesNotMatch(message.subject, /[\r\n]/);
  assert.match(message.text, /does not confirm that your bank has credited a refund/);
  assert.match(message.html, /https:\/\/app\.yrdly\.ng\/my-tickets/);
});

test('missing email configuration fails for queue retry rather than claiming delivery', async () => {
  const f = fixture(false);
  await assert.rejects(f.send('ada@example.com', 'Ada', 'Party', null, null, 'key'), /RESEND_NOT_CONFIGURED/);
  assert.equal(f.sent.length, 0);
});
