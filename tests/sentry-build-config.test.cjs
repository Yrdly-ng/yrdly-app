const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function sentryBuildOptions(env) {
  // Run the real config with only the Sentry build wrapper replaced by a spy.
  const source = fs.readFileSync('next.config.mjs', 'utf8').replaceAll('import.meta.url', JSON.stringify('file:///fixture/next.config.mjs'));
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true, esModuleInterop: true },
    fileName: 'next.config.js',
  }).outputText;
  let options;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'process', compiled)(
    id => id === '@sentry/nextjs/config'
      ? { withSentryConfig: (config, value) => { options = value; return config; } }
      : require(id),
    mod, mod.exports, { env },
  );
  return options;
}

test('source maps upload with the auth token and the configured default organization and project', () => {
  const options = sentryBuildOptions({ SENTRY_AUTH_TOKEN: 'fixture' });
  assert.equal(options.org, 'yrdly-ltd');
  assert.equal(options.project, 'yrdly-app');
  assert.equal(options.sourcemaps.disable, false);
  assert.equal(options.sourcemaps.deleteSourcemapsAfterUpload, true);
});

test('source map upload respects explicit targets and opt-outs', () => {
  const explicit = sentryBuildOptions({ SENTRY_AUTH_TOKEN: 'fixture', SENTRY_ORG: 'fixture-org', SENTRY_PROJECT: 'fixture-app' });
  assert.equal(explicit.org, 'fixture-org');
  assert.equal(explicit.project, 'fixture-app');
  assert.equal(explicit.sourcemaps.disable, false);
  for (const env of [{}, { SENTRY_AUTH_TOKEN: 'fixture', SENTRY_DISABLE_AUTO_UPLOAD: 'true' }, { SENTRY_AUTH_TOKEN: 'fixture', NEXT_PUBLIC_TELEMETRY_DISABLED: 'true' }]) {
    assert.equal(sentryBuildOptions(env).sourcemaps.disable, true);
  }
});
