const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const catalogue = require('../src/lib/payments/bank-logo-catalogue.json');
function load(file, imports) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', source)(name => imports[name], mod.exports);
  return mod.exports;
}
const model = load('src/lib/payments/bank-logo.ts', { './bank-logo-catalogue.json': catalogue });
const hook = load('src/hooks/use-bank-logos.ts', { '@/lib/payments/bank-logo': model });
test('bank identity resolves opaque provider codes, aliases, padded legacy codes and current NIP codes', () => {
  const { getBankLogo } = hook.useBankLogos();
  for (const name of ['Guaranty Trust Bank', 'GTBank PLC', 'GTBank']) assert.match(getBankLogo('opaque-code', name), /guaranty-trust-bank/);
  assert.match(getBankLogo('100004', 'OPay Digital Services Limited'), /paycom/);
  assert.match(getBankLogo('090267', 'KUDA MICROFINANCE BANK'), /kuda-bank/);
  assert.match(getBankLogo('058'), /guaranty-trust-bank/);
  assert.match(getBankLogo(58), /guaranty-trust-bank/);
  assert.match(getBankLogo('000013'), /guaranty-trust-bank/);
});
test('provided bank identity wins over conflicting codes; unknown banks never borrow another brand', () => {
  assert.equal(model.resolveBankLogo('058', 'Zenith Bank'), 'zenith-bank.png');
  assert.equal(model.resolveBankLogo('058', 'Unknown Rural Bank'), null);
  for (const code of [null, undefined, '', '123456789', '000058']) assert.equal(model.resolveBankLogo(code), null);
});
test('every catalogued mark exists as a PNG in web and mobile and catalogues stay in sync', () => {
  const mobile = path.resolve('../yrdly-mobile');
  assert.deepEqual(catalogue, JSON.parse(fs.readFileSync(path.join(mobile,'src/lib/payments/bank-logo-catalogue.json'))));
  for (const bank of catalogue) {
    const web = fs.readFileSync(path.join('public/bank-logos',bank.file));
    assert.deepEqual(web.subarray(0,8), Buffer.from([137,80,78,71,13,10,26,10]));
    assert.deepEqual(web, fs.readFileSync(path.join(mobile,'assets/bank-logos',bank.file)));
  }
});
