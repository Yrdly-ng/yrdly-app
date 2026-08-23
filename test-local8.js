const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://yoiyqxtpmxnrrbqqidcs.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8'
);

async function test() {
  const { data: user, error } = await supabase.auth.admin.getUserById('e54dd024-c9d9-487a-8039-3b20182a55ac');
  if (user?.user) {
    const { error: insertError } = await supabase.from('users').insert({
      id: user.user.id,
      name: user.user.user_metadata?.name || 'Unknown',
      email: user.user.email,
      phone: user.user.phone || user.user.user_metadata?.phone
    });
    console.log("Insert result:", insertError);
  }
}

test();
