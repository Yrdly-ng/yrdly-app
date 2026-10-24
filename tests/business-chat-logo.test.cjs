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
  test(`${route}: chat displays and persists the dedicated business logo`, async () => {
    const inserted = [];
    const user = { id: 'customer' };
    const business = { id: 'shop', owner_id: 'owner', name: 'Shop', logo_url: 'logo.png', image_urls: ['banner.png'] };
    const supabase = { from(table) {
      let payload;
      const result = () => ({ data: payload ? { id: 'conversation' } : table === 'businesses' ? business : table === 'catalog_items' ? { id: 'item', title: 'Product', images: [] } : table === 'public_profiles' ? { name: 'Customer' } : [], error: null });
      const query = {
        select() { return query; }, eq() { return query; }, contains() { return query; },
        insert(value) { payload = value; inserted.push(value); return query; },
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
      '@/lib/notifications/notification-service': { NotificationService: { createCatalogItemInquiryNotification: async () => {} } },
      'next/navigation': { useParams: () => ({ businessId: 'shop', itemId: 'item' }), useRouter: () => ({ push() {} }) },
      '@/components/messages/BusinessChatScreen': { BusinessChatScreen: props => { screen = props; return null; } },
    }).default;
    const root = createRoot(document.createElement('div'));
    try {
      await React.act(async () => { root.render(React.createElement(Page)); });
      assert.equal(screen.business.logo, 'logo.png');
      assert.equal(inserted.length, 1);
      assert.equal(inserted[0].business_logo, 'logo.png');
      assert.equal(screen.conversationId, 'conversation');
    } finally { await React.act(async () => root.unmount()); }
  });
}
