const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync('src/lib/auth/phone-otp-errors.ts', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { describePhoneOtpFailure } = mod.exports;

const failed = (status, payload) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => payload },
});

test('409 returns the already-registered-number message instead of Supabase generic error', async () => {
  const message = await describePhoneOtpFailure(failed(409, { error: 'This phone number is already verified on another account.' }));
  assert.match(message, /already verified on another YRDLY account/);
  assert.match(message, /skip phone verification/);
  assert.doesNotMatch(message, /non-2xx/);
});

test('429 shows rate-limiting advice', async () => {
  const message = await describePhoneOtpFailure(failed(429, { error: 'Too many requests. Please try again later.' }));
  assert.match(message, /wait 15 minutes/);
});

test('400 shows the expected Nigerian input format', async () => {
  const message = await describePhoneOtpFailure(failed(400, { error: 'Invalid Nigerian phone number' }));
  assert.match(message, /without the leading 0/);
});

test('401 prompts login again', async () => {
  const message = await describePhoneOtpFailure(failed(401, { error: 'Session revoked' }));
  assert.match(message, /sign in again/);
});

test('502 tells user SMS delivery failed without showing backend diagnostics', async () => {
  const message = await describePhoneOtpFailure(failed(502, { error: 'Unable to send verification code' }));
  assert.match(message, /couldn't send your SMS/);
});

test('503 provides temporary-unavailability guidance', async () => {
  const message = await describePhoneOtpFailure(failed(503, { error: 'Verification unavailable' }));
  assert.match(message, /temporarily unavailable/);
});

test('non-JSON responses fail safely', async () => {
  const message = await describePhoneOtpFailure({
    context: { status: 502, json: async () => { throw Error('bad json'); } },
  });
  assert.match(message, /couldn't send your SMS/);
});

test('untrusted provider messages are never shown to users', async () => {
  const message = await describePhoneOtpFailure(failed(500, { error: 'internal configuration and private data' }));
  assert.doesNotMatch(message, /private data|internal configuration/);
  assert.match(message, /skip this step/);
});

test('recognized response errors are handled even without a transport error', async () => {
  const message = await describePhoneOtpFailure(null, { error: 'Invalid Nigerian phone number' });
  assert.match(message, /Enter a valid Nigerian mobile number/);
});
