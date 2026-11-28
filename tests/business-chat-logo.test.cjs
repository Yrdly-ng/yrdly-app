const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://yrdly.test/businesses/shop/chat' });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
function compile(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(
    name => mocks[name] || (name === 'react' ? React : require(name)), module, module.exports,
  );
  return module.exports;
}
const presentation = compile('src/lib/businesses/presentation.ts');
for (const route of [
  'src/app/(app)/businesses/[businessId]/chat/page.tsx',
  'src/app/(app)/businesses/[businessId]/catalog/[itemId]/chat/page.tsx',
]) {
  test(`${route}: chat displays the dedicated logo and requests server-side conversation creation`, async () => {
    const calls = [];
    const user = { id: 'customer' };
    const business = { id: 'shop', name: 'Shop', logo_url: 'logo.png', image_urls: ['banner.png'] };
    const supabase = { from(table) {
      let payload;
      const result = () => ({ data: payload ? { id: 'conversation' } : table === 'businesses' ? business : table === 'catalog_items' ? { id: 'item', title: 'Product', images: [] } : table === 'public_profiles' ? { name: 'Customer' } : [], error: null });
      const query = {
        select() { return query; }, eq() { return query; }, contains() { return query; },
        insert(value) { payload = value; return query; },
        single() { return Promise.resolve(result()); }, maybeSingle() { return Promise.resolve(result()); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    } };
    let screen;
    const Page = compile(route, {
      '@/lib/supabase/supabase': { supabase },
      '@/hooks/use-supabase-auth': { useAuth: () => ({ user }) },
      '@/lib/businesses/presentation': presentation,
      '@/lib/auth/authenticated-fetch': { authenticatedFetch: async (path, body) => { calls.push({ path, body }); return { conversationId: 'conversation' }; } },
      'next/navigation': { useParams: () => ({ businessId: 'shop', itemId: 'item' }), useRouter: () => ({ push() {} }) },
      '@/components/messages/BusinessChatScreen': { BusinessChatScreen: props => { screen = props; return null; } },
    }).default;
    const root = createRoot(document.createElement('div'));
    try {
      await React.act(async () => { root.render(React.createElement(Page)); });
      assert.equal(screen.business.logo, 'logo.png');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].path, '/api/businesses/conversations');
      assert.equal(calls[0].body.businessId, 'shop');
      if (route.includes('[itemId]')) assert.equal(calls[0].body.itemId, 'item');
      assert.equal(screen.conversationId, 'conversation');
    } finally { await React.act(async () => root.unmount()); }
  });
}

test('business chat owner identity is resolved only by the authenticated server endpoint', () => {
  const endpoint = fs.readFileSync('src/app/api/businesses/conversations/route.ts', 'utf8');
  const generalPage = fs.readFileSync('src/app/(app)/businesses/[businessId]/chat/page.tsx', 'utf8');
  const itemPage = fs.readFileSync('src/app/(app)/businesses/[businessId]/catalog/[itemId]/chat/page.tsx', 'utf8');

  assert.match(endpoint, /getAuthenticatedUser\(request\)/);
  assert.match(endpoint, /owner_id/);
  assert.match(endpoint, /participant_ids: participantIds/);
  assert.match(endpoint, /catalog_item_inquiry/);
  assert.doesNotMatch(generalPage, /owner_id/);
  assert.doesNotMatch(itemPage, /owner_id/);
});

test('business detail keeps the business owner ID server-side for non-owners', () => {
  const page = fs.readFileSync('src/app/(app)/businesses/[businessId]/BusinessDetailPageClient.tsx', 'utf8');
  const endpoint = fs.readFileSync('src/app/api/businesses/viewer-context/route.ts', 'utf8');
  assert.match(page, /\/api\/businesses\/viewer-context/);
  assert.doesNotMatch(page, /businessData\.owner_id|id, owner_id/);
  assert.match(page, /owner_id: isOwner && user \? user\.id : ""/);
  assert.match(endpoint, /getAuthenticatedUser\(request\)/);
  assert.match(endpoint, /owner_id/);
  assert.match(endpoint, /isOwner/);
});

test('public business catalog reads use explicit approved-only projections', () => {
  const screen = fs.readFileSync('src/components/businesses/BusinessDetailScreen.tsx', 'utf8');
  assert.match(screen, /const catalogQuery = isOwner[\s\S]*?\.select\("\*"\)/);
  assert.match(screen, /\.select\("id, business_id, title, description, price, images, category, in_stock, created_at, updated_at"\)/);
  assert.match(screen, /\.eq\("moderation_status", "approved"\)/);
});

test('public chat routes only load active approved businesses and approved catalog items', () => {
  const generalPage = fs.readFileSync('src/app/(app)/businesses/[businessId]/chat/page.tsx', 'utf8');
  const itemPage = fs.readFileSync('src/app/(app)/businesses/[businessId]/catalog/[itemId]/chat/page.tsx', 'utf8');
  assert.match(generalPage, /moderation_status', 'approved'/);
  assert.match(generalPage, /is_flagged', false/);
  assert.match(itemPage, /moderation_status', 'approved'/);
  assert.match(itemPage, /is_flagged', false/);
  assert.doesNotMatch(itemPage, /catalog_items[\s\S]{0,120}select\('\*'\)/);
});
