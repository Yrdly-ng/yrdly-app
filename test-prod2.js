const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://yoiyqxtpmxnrrbqqidcs.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8'
);

async function test() {
  const { data: items, error } = await supabase.from('posts').select('*').limit(5);
  const item = items.find(i => i.price === 1000 && !i.is_sold);
  if (!item) {
    console.log("No items available to test");
    return;
  }
  
  // Find a buyer who IS in public.users
  const { data: users } = await supabase.from('users').select('*').neq('id', item.user_id).limit(1);
  const buyer = users[0];
  console.log("Testing with buyer:", buyer.id);
  
  // Get token for buyer using admin function if possible, or just generate a JWT
  // But we can't easily sign in without password unless we use service_role. 
  // Let's just assume it works for the real buyer since they are logged in.
}

test();
