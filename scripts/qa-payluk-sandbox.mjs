// Read-only credential smoke test. Never creates customers, escrows or transfers.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export function sandboxKeyFromQaFile(content) {
  const variables = dotenv.parse(content);
  // Accept the user's existing nonstandard assignment without rewriting .env.qa.
  const candidates = [...new Set(content.split(/\r?\n/).filter(line => !line.trim().startsWith('#'))
    .join('\n').match(/\bsk_test_[A-Za-z0-9_-]+\b/g) || [])];
  const key = variables.PAYLUK_SECRET_KEY || (candidates.length === 1 ? candidates[0] : '');
  if (!/^sk_test_[A-Za-z0-9_-]+$/.test(key)) throw new Error('An unambiguous Payluk sandbox key is required in .env.qa');
  return key;
}

export async function runSandboxSmoke(content, fetchRequest = fetch) {
  const key = sandboxKeyFromQaFile(content);
  // Fixed staging host: production environment/base-URL overrides are ignored.
  const response = await fetchRequest('https://staging.api.payluk.ng/v1/countries', {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  const body = await response.json();
  return { environment:'sandbox', operation:'GET /v1/countries', httpStatus:response.status,
    providerStatus:body.status, passed:response.ok && typeof body.status === 'number' && body.status < 400 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const content = await readFile(new URL('../.env.qa', import.meta.url), 'utf8');
    const result = await runSandboxSmoke(content);
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    // Provider payloads, credentials, and QA account details must never be logged.
    console.error(JSON.stringify({ environment:'sandbox', operation:'GET /v1/countries',
      passed:false, failureCode:error.cause?.code || error.code || error.name }));
    process.exitCode = 1;
  }
}
