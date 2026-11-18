const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const ID = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-11-17T17:00:00Z');
function compile(file, requireMock, processMock) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', 'process', output)(module, module.exports, requireMock, processMock);
  return module.exports;
}
async function readQuestion({ id = ID, status = 'approved', date = '2026-11-16', enabled = true, error = null } = {}) {
  const calls = [];
  const clock = compile('src/lib/daily-prompts/daily-prompt-clock.ts', () => {}, { env: { DAILY_PROMPTS_ENABLED: String(enabled) } });
  const query = { select(value) { calls.push(['select', value]); return this; }, eq(key, value) { calls.push([key, value]); return this; }, async maybeSingle() { return { data: { id: ID, status, prompt_date: date, question: 'What is your favourite restaurant in your area?', category: 'food' }, error }; } };
  const route = compile('src/app/api/daily-prompts/route.ts', name => {
    if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
    if (name.endsWith('supabase-admin')) return { supabaseAdmin: { from: () => query } };
    if (name.endsWith('daily-prompt-clock')) return { ...clock, lagosPromptClock: () => clock.lagosPromptClock(now), isVisiblePrompt: prompt => clock.isVisiblePrompt(prompt, now) };
    throw new Error(name);
  });
  return { result: await route.GET({ nextUrl: new URL('https://qa.example/api/daily-prompts' + (id === null ? '' : '?promptId=' + encodeURIComponent(id))) }), calls };
}
test('historical approved question keeps its original context and selects by ID', async () => {
  const { result, calls } = await readQuestion();
  assert.equal(result.status, 200);
  assert.equal(result.body.prompt.question, 'What is your favourite restaurant in your area?');
  assert.equal(result.body.prompt.prompt_date, '2026-11-16');
  assert.ok(calls.some(([key, value]) => key === 'id' && value === ID));
  assert.ok(calls.some(([key, value]) => key === 'status' && value === 'approved'));
  assert.equal('status' in result.body.prompt, false);
});
test('draft, paused and future questions are not exposed through post quotes', async () => {
  for (const input of [{ status: 'draft' }, { status: 'paused' }, { date: '2026-11-18' }]) {
    const { result } = await readQuestion(input);
    assert.equal(result.status, 404);
    assert.equal(result.body.prompt, undefined);
  }
});
test('malformed IDs fail without querying and disabled feature stays closed', async () => {
  const malformed = await readQuestion({ id: 'not-a-question' });
  assert.equal(malformed.result.status, 400);
  assert.equal(malformed.calls.length, 0);
  const disabled = await readQuestion({ enabled: false });
  assert.equal(disabled.result.body.prompt, null);
  assert.equal(disabled.calls.length, 0);
});
test('today lookup still uses Nigeria date and service errors do not leak a question', async () => {
  const current = await readQuestion({ id: null, date: '2026-11-17' });
  assert.ok(current.calls.some(([key, value]) => key === 'prompt_date' && value === '2026-11-17'));
  const failed = await readQuestion({ error: { code: 'QA_ERROR' } });
  assert.equal(failed.result.status, 503);
  assert.equal(failed.result.body.prompt, undefined);
});
