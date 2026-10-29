const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://yrdly.test' });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const pending = [];
function load() {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/components/events/TicketEntryCode.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'next/image') return { __esModule: true, default: ({ unoptimized, ...props }) => React.createElement('img', props) };
    if (name === 'qrcode') return { toDataURL: (token, options) => new Promise((resolve, reject) => pending.push({ token, options, resolve, reject })) };
    throw new Error('Unmocked ' + name);
  }, module, module.exports);
  return module.exports.TicketEntryCode;
}
test('entry QR is generated locally and never shows a stale token during changes', async () => {
  const Component = load();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(Component, { token: 'ticket-A' })));
    assert.equal(host.querySelector('img'), null);
    assert.equal(pending[0].token, 'ticket-A');
    await act(async () => pending[0].resolve('data:image/png;base64,AAA'));
    assert.equal(host.querySelector('img').getAttribute('src'), 'data:image/png;base64,AAA');
    await act(async () => root.render(React.createElement(Component, { token: 'ticket-B' })));
    assert.equal(host.querySelector('img'), null, 'old entry code is removed immediately');
    assert.equal(pending[1].token, 'ticket-B');
    await act(async () => root.render(null));
    await act(async () => pending[1].resolve('data:image/png;base64,BBB'));
    assert.equal(host.querySelector('img'), null, 'late generation cannot restore a removed code');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
test('QR generation error offers retry without an external fallback', async () => {
  pending.length = 0;
  const Component = load();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(Component, { token: 'ticket-C' })));
    await act(async () => pending[0].reject(new Error('generation failed')));
    assert.equal(host.querySelector('img'), null);
    assert.match(host.textContent, /Try again/);
    await act(async () => host.querySelector('button').click());
    assert.equal(pending[1].token, 'ticket-C');
    await act(async () => pending[1].resolve('data:image/png;base64,CCC'));
    assert.equal(host.querySelector('img').getAttribute('src'), 'data:image/png;base64,CCC');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
