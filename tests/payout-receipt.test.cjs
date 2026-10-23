const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadReceiptModule() {
  const file = path.join(__dirname, '../src/lib/payments/payout-receipt.ts');
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(output, file);
  return loaded.exports;
}

const { toPayoutReceipt } = loadReceiptModule();
const row = (overrides = {}) => ({
  id: '7f59d510-4aac-4b55-bd8b-27cfe1a48821',
  amount: 1150,
  status: 'completed',
  requested_at: '2026-10-22T01:35:16.667Z',
  processed_at: '2026-10-22T10:02:32.658Z',
  account_id: 'b73e70f1-d2d7-41c1-868d-3f0d88bb70f4',
  receipt_snapshot: null,
  seller_account: {
    created_at: '2026-10-20T19:30:50.106Z',
    updated_at: '2026-10-20T19:30:50.106Z',
    account_details: {
      bank_name: 'OPAY',
      bank_code: '999992',
      account_name: 'TEST ACCOUNT HOLDER',
      account_number: '0123456243',
    },
  },
  ...overrides,
});

test('uses unchanged linked bank details for a legacy receipt and masks the account number', () => {
  const receipt = toPayoutReceipt(row());
  assert.equal(receipt.bankName, 'OPAY');
  assert.equal(receipt.accountName, 'TEST ACCOUNT HOLDER');
  assert.equal(receipt.accountNumber, '•••• 6243');
  assert.equal(receipt.destinationSource, 'linked_account_unchanged');
  assert.equal(JSON.stringify(receipt).includes('0123456243'), false);
});

test('does not infer historical destination after the linked account changed', () => {
  const receipt = toPayoutReceipt(row({
    seller_account: {
      ...row().seller_account,
      updated_at: '2026-10-23T10:00:00.000Z',
    },
  }));
  assert.equal(receipt.bankName, null);
  assert.equal(receipt.accountName, null);
  assert.equal(receipt.destinationSource, 'unavailable');
});

test('prefers the payout snapshot over the linked account', () => {
  const receipt = toPayoutReceipt(row({
    receipt_snapshot: {
      bankName: 'Snapshot Bank',
      bankCode: '001',
      accountName: 'SAVED RECIPIENT',
      accountNumber: '•••• 7788',
    },
  }));
  assert.equal(receipt.bankName, 'Snapshot Bank');
  assert.equal(receipt.accountName, 'SAVED RECIPIENT');
  assert.equal(receipt.accountNumber, '•••• 7788');
  assert.equal(receipt.destinationSource, 'snapshot');
});
