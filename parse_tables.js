const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/macbook/.gemini/antigravity/brain/6842012a-40be-465f-91fa-6909f2d2b391/.system_generated/steps/4132/output.txt', 'utf8'));

const tables = data.tables || data;
const targets = ['public.users', 'public.posts', 'public.events', 'public.marketplace_items', 'public.items'];

tables.forEach(t => {
  if (targets.includes(t.name) || t.name.includes('post') || t.name.includes('item')) {
    console.log(`\n--- ${t.name} ---`);
    t.columns.forEach(c => {
      if (['state', 'lga', 'ward', 'location'].includes(c.name) || c.name.includes('loc')) {
        console.log(`  ${c.name}: ${c.data_type}`);
      }
    });
  }
});
