// Create/deploy only the dedicated QA project. Credentials travel through stdin.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readQaEnv, ROOT } from './qa-common.mjs';

const scope = 'calebs-projects-98954387';
const name = 'yrdly-app-qa';
const productionId = 'prj_OzlnXKjvwAnaDjWqbtEl2gfLhPEx';
const artifacts = resolve(ROOT, '.qa-artifacts');
const stateFile = resolve(artifacts, 'vercel-qa.json');
const mode = process.argv[2];
if (!['configure', 'deploy', 'status'].includes(mode)) throw new Error('Use configure, deploy or status');
const { env } = await readQaEnv();
if (!env.PAYLUK_SECRET_KEY?.startsWith('sk_test_') || !env.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY?.startsWith('pk_test_')) throw new Error('QA payment keys required');

function cli(args, input, cwd = ROOT, allowFailure = false) {
  const result = spawnSync('vercel', [...args, '--scope', scope], {
    cwd, input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
    timeout: 15 * 60 * 1000,
  });
  if (result.status !== 0 && !allowFailure) {
    let details = (result.stderr || '') + '\n' + (result.stdout || '');
    for (const value of Object.values(env).filter(value => value.length > 4)) details = details.replaceAll(value, '[redacted]');
    if (input) details = details.replaceAll(input, '[redacted]');
    throw new Error(`Vercel ${args[0]} failed (exit ${result.status}): ${details.slice(-1200)}`);
  }
  return result;
}
function api(path, method = 'GET', body) {
  const response = cli(['api', path, '--raw', ...(method === 'GET' ? [] : ['--method', method, '--input', '-'])], body ? JSON.stringify(body) : undefined);
  try { return JSON.parse(response.stdout); } catch { throw new Error('Invalid Vercel API response; details withheld'); }
}
await mkdir(artifacts, { recursive: true });
let state;
if (mode === 'configure') {
  let project;
  const lookup = cli(['api', `/v9/projects/${name}`, '--raw'], undefined, ROOT, true);
  if (lookup.status === 0) project = JSON.parse(lookup.stdout);
  else {
    cli(['project', 'add', name]);
    project = api(`/v9/projects/${name}`);
  }
  if (project.name !== name || project.id === productionId) throw new Error('Refusing non-QA project');
  api(`/v9/projects/${project.id}`, 'PATCH', { framework: 'nextjs', nodeVersion: '24.x', buildCommand: 'pnpm run build:webpack', installCommand: 'pnpm install --frozen-lockfile', ssoProtection: null });
  const source = resolve(artifacts, `vercel-source-${Date.now()}`);
  await mkdir(resolve(source, '.vercel'), { recursive: true });
  const archive = resolve(artifacts, 'qa-deploy.tar');
  for (const [command, args] of [['git', ['archive', '--format=tar', '-o', archive, 'HEAD']], ['tar', ['-xf', archive, '-C', source]]]) {
    if (spawnSync(command, args, { cwd: ROOT }).status !== 0) throw new Error('Unable to prepare committed QA source');
  }
  const link = JSON.parse(await readFile(resolve(ROOT, '.vercel/project.json'), 'utf8'));
  await writeFile(resolve(source, '.vercel/project.json'), JSON.stringify({ projectId: project.id, orgId: link.orgId, projectName: name }));
  const config = JSON.parse(await readFile(resolve(source, 'vercel.json'), 'utf8'));
  delete config.crons;
  config.buildCommand = 'pnpm run build:webpack';
  await writeFile(resolve(source, 'vercel.json'), JSON.stringify(config, null, 2));
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    PAYLUK_SECRET_KEY: env.PAYLUK_SECRET_KEY,
    NEXT_PUBLIC_PAYLUK_PUBLIC_KEY: env.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY,
    PAYLUK_BASE_URL: 'https://staging.api.payluk.ng',
    NEXT_PUBLIC_APP_URL: `https://${name}.vercel.app`,
    PAYMENT_PROVIDER: 'payluk',
    QA_ENVIRONMENT: 'staging',
    QA_EXPECTED_PROJECT_REF: 'jxgpvvehajxegeeozlnl',
  };
  for (const [key, value] of Object.entries(values)) {
    cli(['env', 'add', key, 'production', '--force', '--yes'], value, source);
    console.log(`Configured QA-only variable: ${key}`);
  }
  // No delivery keys, cron secrets or live keys are inherited from the live app.
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  state = { projectId: project.id, projectName: name, source, revision, configuredAt: new Date().toISOString() };
  await writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log('Dedicated QA project configured; production project unchanged.');
} else {
  state = JSON.parse(await readFile(stateFile, 'utf8'));
  if (state.projectName !== name || state.projectId === productionId || !state.source.startsWith(artifacts + '/')) throw new Error('Invalid QA project state');
  if (mode === 'deploy') {
    console.log(`Deploying committed revision ${state.revision.slice(0, 8)} to the dedicated QA project…`);
    const result = cli(['deploy', '--prod', '--yes'], undefined, state.source);
    const urls = result.stdout.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) || [];
    if (!urls.length) throw new Error('Deployment returned no URL; inspect QA project status');
    state.deploymentUrl = urls.at(-1);
    state.deployedAt = new Date().toISOString();
    await writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ project: name, revision: state.revision, deploymentUrl: state.deploymentUrl }));
  } else {
    const project = api(`/v9/projects/${state.projectId}`);
    console.log(JSON.stringify({ name: project.name, revision: state.revision, deploymentUrl: state.deploymentUrl || null, protectionEnabled: Boolean(project.ssoProtection), deployments: project.latestDeployments?.map(d => ({ id: d.id, readyState: d.readyState, url: d.url })) }));
  }
}
