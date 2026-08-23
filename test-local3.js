const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://yoiyqxtpmxnrrbqqidcs.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8'
);

async function test() {
  const { data: posts, error } = await supabase.from('posts').select('*').eq('price', 1030);
  console.log("Posts with 1030:", posts?.map(p => ({id: p.id, title: p.title})));

  const { data: catalogItems } = await supabase.from('catalog_items').select('*').eq('price', 1030);
  console.log("Catalog Items with 1030:", catalogItems?.map(c => ({id: c.id, title: c.title})));
}

test();
