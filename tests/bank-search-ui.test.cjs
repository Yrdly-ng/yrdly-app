const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://qa.invalid' });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const fixture = [
  { name: 'Guaranty Trust Bank', code: 'provider-gt' },
  { name: 'United Bank For Africa', code: 'provider-uba' },
  { name: 'Zenith Bank', code: 'provider-zenith' },
];
const toast = () => {};
const box = ({ children }) => React.createElement('div', null, children);
const native = {
  View: box, Text: box, ScrollView: box,
  TouchableOpacity: ({ children, onPress }) => React.createElement('button', { onClick: onPress }, children),
  TextInput: ({ value, onChangeText, placeholder }) => React.createElement('input', { value, onChange: e => onChangeText(e.target.value), placeholder }),
  FlatList: ({ data, renderItem, ListEmptyComponent }) => React.createElement('div', null,
    data.length ? data.map((item, index) => React.createElement('div', { key: item.code }, renderItem({ item, index }))) : ListEmptyComponent),
  ActivityIndicator: () => React.createElement('span', null, 'Loading'),
  Alert: { alert: () => {} }, Platform: { OS: 'ios' },
};
function load(file, api) {
  const m = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mocks = {
    'next/navigation': { useRouter: () => ({ back() {}, push() {} }) },
    'expo-router': { useRouter: () => ({ back() {}, push() {} }) },
    '@/hooks/use-toast': { useToast: () => ({ toast }) },
    'react-native': native,
    'react-native-unistyles': { useUnistyles: () => ({ theme: { colors: {} } }), StyleSheet: { create: () => ({}) } },
    'react-native-keyboard-controller': { KeyboardAvoidingView: box },
    'react-native-safe-area-context': { SafeAreaView: box },
    '@expo/vector-icons': { Ionicons: () => null, Feather: () => null },
    '../../lib/network/api': { api },
    '../../hooks/notifications/use-notification-route-ack': { useNotificationRouteAcknowledgement: () => {} },
  };
  new Function('require', 'module', 'exports', code)(name => {
    if (mocks[name]) return mocks[name];
    if (name.includes('BankLogo')) return { BankLogo: () => null };
    if (name.startsWith('@/lib/')) return load(path.resolve('src', name.slice(2)) + '.ts', api);
    if (name.startsWith('.')) {
      const target = path.resolve(path.dirname(file), name);
      return name.endsWith('.json') ? JSON.parse(fs.readFileSync(target, 'utf8')) : load(target + '.ts', api);
    }
    return require(name);
  }, m, m.exports);
  return m.exports;
}
async function mount(platform, fail = false) {
  let failed = fail;
  let bankRequests = 0;
  const api = { get: async url => {
    if (url.endsWith('/banks')) { bankRequests++; if (failed) throw new Error('Bank list unavailable'); return { success: true, banks: fixture }; }
    return { account: null };
  }};
  const previous = global.fetch;
  global.fetch = async url => {
    try { return Response.json(await api.get(url)); }
    catch { return Response.json({ error: 'Bank list unavailable' }, { status: 503 }); }
  };
  const file = platform === 'web' ? 'src/app/(app)/settings/payout-settings/page.tsx' : '../yrdly-mobile/src/app/settings/payout-settings.tsx';
  const Component = load(path.resolve(file), api).default;
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(React.createElement(Component)));
  return { el, recover: () => { failed = false; }, requests: () => bankRequests,
    search: async value => {
      const input = el.querySelector('input'); assert.ok(input);
      await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
    },
    close: async () => { await act(() => root.unmount()); el.remove(); global.fetch = previous; },
  };
}
// The sibling mobile repository is optional in the web repository's CI checkout.
for (const platform of fs.existsSync('../yrdly-mobile/src/app/settings/payout-settings.tsx') ? ['web', 'mobile'] : ['web']) {
  test(`${platform}: searches normal, padded and common bank names and selects the matching provider bank`, async () => {
    const h = await mount(platform);
    try {
      for (const [query, name] of [['zenith', 'Zenith Bank'], ['  ZeNiTh  ', 'Zenith Bank'], ['GTBank', 'Guaranty Trust Bank'], ['u.b.a', 'United Bank For Africa']]) {
        await h.search(query);
        const banks = [...h.el.querySelectorAll('button')].filter(b => fixture.some(bank => b.textContent.includes(bank.name)));
        assert.deepEqual(banks.map(b => b.textContent), [name], `${platform} search ${query}`);
      }
      await h.search('  ZeNiTh  ');
      const bank = [...h.el.querySelectorAll('button')].find(b => b.textContent === 'Zenith Bank');
      await act(() => bank.click());
      assert.match(h.el.textContent, /Verify Account/);
    } finally { await h.close(); }
  });
  test(`${platform}: no matches has a clear message and clearing search restores the list`, async () => {
    const h = await mount(platform);
    try { await h.search('no-such-bank'); assert.match(h.el.textContent, /No banks found/i); await h.search(''); assert.match(h.el.textContent, /Zenith Bank/); }
    finally { await h.close(); }
  });
  test(`${platform}: bank-list failure offers retry and recovers without remounting`, async () => {
    const h = await mount(platform, true);
    try {
      assert.match(h.el.textContent, /Could not load banks/i);
      const retry = [...h.el.querySelectorAll('button')].find(b => /try again/i.test(b.textContent)); assert.ok(retry);
      h.recover(); await act(async () => retry.click());
      assert.equal(h.requests(), 2); await h.search('zenith'); assert.match(h.el.textContent, /Zenith Bank/);
    } finally { await h.close(); }
  });
}
