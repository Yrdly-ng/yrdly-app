const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://yoiyqxtpmxnrrbqqidcs.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8'
);

async function test() {
  const { data: users, error } = await supabase.auth.admin.listUsers();
  if (error || !users || !users.users.length) {
    console.log("No users found", error);
    return;
  }
  
  const user = users.users.find(u => u.phone) || users.users[0];
  console.log("Using user", user.id);
  
  // We cannot easily generate a JWT token from admin role for a specific user without password.
  // We can just create a test user with a known password.
  const password = 'testpassword123';
  const email = 'test' + Date.now() + '@yrdly.com';
  
  const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Test User', phone: '08012345678' }
  });
  
  if (createError) {
    console.log("Create user error", createError);
    return;
  }
  
  const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  if (signInError) {
    console.log("Sign in error", signInError);
    return;
  }
  
  const token = sessionData.session.access_token;
  
  const res = await fetch('https://app.yrdly.ng/api/payment/initialize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      itemId: 'test-item-123',
      buyerId: sessionData.user.id,
      sellerId: 'c290141a-2fa9-4b6d-a1ad-46743b18561d', // random user
      price: 1030,
      buyerEmail: sessionData.user.email,
      itemType: 'post'
    })
  });

  const text = await res.text();
  console.log("Response status:", res.status);
  console.log("Response body:", text);
}

test();
