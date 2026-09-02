import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://yoiyqxtpmxnrrbqqidcs.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
async function fetchEvents() {
  const { data, error } = await supabase.from('events').select('id, title, created_at, organizer_id').order('created_at', { ascending: false }).limit(5);
  console.log('Recent Events:', data);
  const { data: qData } = await supabase.from('moderation_queue').select('*').order('created_at', { ascending: false }).limit(5);
  console.log('Recent Moderation Queue:', qData);
}
fetchEvents();
