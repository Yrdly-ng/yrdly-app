const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://yoiyqxtpmxnrrbqqidcs.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8'
);

async function test() {
  const { data: items, error } = await supabase.from('posts').select('*').limit(5);
  if (error || !items) {
    console.log("Error fetching items", error);
    return;
  }
  const item = items.find(i => i.price > 0 && !i.is_sold);
  if (!item) {
    console.log("No items available to test");
    return;
  }
  
  console.log("Testing with item:", item.id, item.price);
  
  const password = 'testpassword123';
  const email = 'test' + Date.now() + '@yrdly.com';
  
  await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Test User', phone: '08012345678' }
  });
  
  const { data: sessionData } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  const token = sessionData.session.access_token;
  
  const res = await fetch('https://app.yrdly.ng/api/payment/initialize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      itemId: item.id,
      buyerId: sessionData.user.id,
      sellerId: item.user_id,
      price: item.price,
      buyerEmail: sessionData.user.email,
      itemType: 'post'
    })
  });

  const text = await res.text();
  console.log("Response status:", res.status);
  console.log("Response body:", text);
}

test();
