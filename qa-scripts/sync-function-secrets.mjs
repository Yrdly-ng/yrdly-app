import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { readQaEnv, QA_PROJECT_REF, ROOT } from './qa-common.mjs';

const { env, projectRef } = await readQaEnv();
const names = ['TERMII_API_KEY', 'SIGHTENGINE_API_USER', 'SIGHTENGINE_API_SECRET'];
if (names.some(name => !env[name] || /[\r\n]/.test(env[name]))) throw new Error('Missing or invalid QA provider credentials');
for (const name of ['TERMII_BASE_URL', 'TERMII_SENDER_ID']) if (env[name]) names.push(name);
if (projectRef !== QA_PROJECT_REF) throw new Error('QA project required');
const file = `${ROOT}/.qa-artifacts/function-secrets.env`;
await mkdir(`${ROOT}/.qa-artifacts`, { recursive: true });
await writeFile(file, names.map(name => `${name}=${env[name]}`).join('\n') + '\n', { mode: 0o600 });
await chmod(file, 0o600);
const result = spawnSync('supabase', ['secrets', 'set', '--project-ref', projectRef, '--env-file', file], { cwd: ROOT, encoding: 'utf8' });
if (result.status !== 0) throw new Error('Unable to set QA function secrets; response withheld');
console.log('Configured isolated QA function secrets: ' + names.join(', '));
