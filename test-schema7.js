import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://yoiyqxtpmxnrrbqqidcs.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
async function test() {
  const { data: users } = await supabase.from('users').select('id').limit(1);
  const userId = users[0].id;
  const { error } = await supabase.from('events').insert({
    organizer_id: userId,
    title: 'Test Event 6',
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    timezone: 'Africa/Lagos',
    status: 'DRAFT', 
    visibility: 'PUBLIC',
    payout_mode: 'POST_EVENT'
  }).select('id').single();
  if (error) console.error('Error with DRAFT:', error);
  else console.log('Success with DRAFT');
}
test();
