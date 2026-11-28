const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function loadCatalogService({ currentUserId, ownerId }) {
  const calls = [];
  const module = { exports: {} };
  const source = ts.transpileModule(
    fs.readFileSync('src/lib/catalog/catalog-service.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  new Function('require', 'module', 'exports', source)(
    (name) => {
      if (name === '../supabase/supabase') {
        return { supabase: {
          auth: { getUser: async () => ({ data: { user: currentUserId ? { id: currentUserId } : null } }) },
          from(table) {
            const query = { table, selected: null, filters: [], select(value) { this.selected=value; return this; },
              eq(key,value) { this.filters.push([key,value]); return this; },
              maybeSingle: async () => ({ data: { owner_id: ownerId }, error: null }),
              single: async () => ({ data: { owner_id: ownerId }, error: null }),
              order: async () => ({ data: [{ id: 'item' }], error: null }) };
            calls.push(query); return query;
          },
          storage: { from() { return {}; } }
        }};
      }
      if (name === '@/types/index') return {};
      throw new Error('Unexpected import: '+name);
    }, module, module.exports
  );
  return { service: module.exports.CatalogService, calls };
}

test('business owners can retrieve pending catalog items for management', async () => {
  const { service, calls } = loadCatalogService({ currentUserId: 'owner-1', ownerId: 'owner-1' });
  assert.deepEqual(await service.getCatalogItemsByBusiness('biz-1'), [{ id: 'item' }]);
  const catalogQuery = calls.find(call => call.table === 'catalog_items');
  assert.ok(catalogQuery);
  assert.deepEqual(catalogQuery.filters, [['business_id', 'biz-1']]);
  assert.equal(catalogQuery.filters.some(([key]) => key === 'moderation_status'), false);
});

test('non-owners request only approved catalog items', async () => {
  const { service, calls } = loadCatalogService({ currentUserId: 'visitor', ownerId: 'owner-1' });
  await service.getCatalogItemsByBusiness('biz-1');
  const catalogQuery = calls.find(call => call.table === 'catalog_items');
  assert.deepEqual(catalogQuery.filters, [['business_id', 'biz-1'], ['moderation_status', 'approved']]);
});

test('anonymous visitors are limited to approved catalog items', async () => {
  const { service, calls } = loadCatalogService({ currentUserId: null, ownerId: 'owner-1' });
  await service.getCatalogItemsByBusiness('biz-1');
  const catalogQuery = calls.find(call => call.table === 'catalog_items');
  assert.deepEqual(catalogQuery.filters, [['business_id', 'biz-1'], ['moderation_status', 'approved']]);
});
