// Read-only GitHub Actions inspection. Keep CLI credentials out of arguments/logs.
import { spawnSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { readQaEnv } from './qa-common.mjs';

const run = process.argv[2];
if (!/^\d+$/.test(run || '')) throw new Error('Provide a GitHub Actions run ID');
const { env } = await readQaEnv();
const auth = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
const token = auth.stdout?.trim();
if (auth.status !== 0 || !token) throw new Error('GitHub CLI authentication unavailable');
async function request(path) {
  const response = await fetch(`https://api.github.com/repos/Yrdly-ng/yrdly-app${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub read failed: HTTP ${response.status}`);
  return response;
}
try {
  const metadata = await (await request(`/actions/runs/${run}`)).json();
  const { jobs } = await (await request(`/actions/runs/${run}/jobs`)).json();
  console.log(JSON.stringify({ runId: metadata.id, revision: metadata.head_sha, status: metadata.status, conclusion: metadata.conclusion, url: metadata.html_url, jobs: jobs.map(job => ({ id: job.id, conclusion: job.conclusion, steps: job.steps.map(step => ({ name: step.name, conclusion: step.conclusion })) })) }));
  await mkdir('.qa-artifacts', { recursive: true });
  for (const job of jobs.filter(job => job.conclusion === 'failure')) {
    let logs = await (await request(`/actions/jobs/${job.id}/logs`)).text();
    for (const secret of [token, ...Object.values(env)].filter(value => value.length > 5)) logs = logs.replaceAll(secret, '[redacted]');
    await writeFile(`.qa-artifacts/ci-${run}-${job.id}.log`, logs, { mode: 0o600 });
    const lines = logs.split('\n');
    const output = new Set();
    for (let i = 0; i < lines.length; i++) if (/AssertionError|Error:|FAIL|not ok|Expected|actual:|expected:|ReferenceError/.test(lines[i])) for (const line of lines.slice(Math.max(0, i - 2), i + 9)) output.add(line);
    console.log([...output].slice(-100).join('\n'));
  }
} catch {
  console.error('Unable to read CI evidence; credential/provider details withheld');
  process.exitCode = 1;
}
