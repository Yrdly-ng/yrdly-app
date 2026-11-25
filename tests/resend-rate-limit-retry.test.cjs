const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadService(responses) {
  const source = fs.readFileSync('src/lib/email/resend-service.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  let sends = 0;
  new Function('require', 'module', 'exports', outputText)((name) => {
    if (name === 'resend') return {
      Resend: class {
        constructor() {
          this.emails = { send: async () => responses[sends++] || { data: { id: 'ok' }, error: null } };
        }
      },
    };
    if (name === './email-templates') return { emailTemplates: {} };
    throw new Error('Unexpected import: ' + name);
  }, module, module.exports);
  return { service: module.exports.ResendEmailService, getSends: () => sends };
}

test('generic Resend email retries one explicit rate-limit rejection and does not log recipient PII', async () => {
  const key = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const { service, getSends } = loadService([
      { data: null, error: { statusCode: 429, name: 'rate_limit_exceeded' } },
      { data: { id: 'accepted' }, error: null },
    ]);
    await service.sendEmail('person@example.test', 'Subject', '<p>Body</p>', 'digest-reminder');
    assert.equal(getSends(), 2);
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = originalWarn;
    if (key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = key;
  }
});

test('generic Resend email does not retry permanent errors or log recipient addresses', async () => {
  const key = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const { service, getSends } = loadService([
      { data: null, error: { statusCode: 400, name: 'invalid_request' } },
    ]);
    await assert.rejects(service.sendEmail('person@example.test', 'Subject', '<p>Body</p>', 'digest-reminder'), /Failed to send digest-reminder/);
    assert.equal(getSends(), 1);
    assert.equal(warnings.length, 1);
    assert.equal(JSON.stringify(warnings).includes('person@example.test'), false);
  } finally {
    console.warn = originalWarn;
    if (key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = key;
  }
});
