const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function loadRoute() {
  const source = fs.readFileSync('src/app/api/cron/unread-notifications/route.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  let clientsCreated = 0;
  new Function('require', 'module', 'exports', outputText)((name) => {
    if (name === 'next/server') return { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } };
    if (name === '@supabase/supabase-js') return { createClient: () => { clientsCreated++; return {}; } };
    if (name === '@/lib/email/resend-service') return { ResendEmailService: { sendEmail: async () => {} } };
    if (name === '@/lib/email/email-templates') return { emailTemplates: { digestReminder: () => ({ subject: '', html: '' }) } };
    throw new Error(name);
  }, module, module.exports);
  return { route: module.exports, getClientsCreated: () => clientsCreated };
}

test('unread notification cron route imports without Supabase credentials and rejects unauthorized calls before client creation', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.CRON_SECRET;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CRON_SECRET;
  try {
    const { route, getClientsCreated } = loadRoute();
    assert.equal(getClientsCreated(), 0);
    const response = await route.GET(new Request('https://fixture.invalid/api/cron/unread-notifications'));
    assert.equal(response.status, 401);
    assert.equal(getClientsCreated(), 0);
  } finally {
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
  }
});
