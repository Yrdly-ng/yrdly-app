import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yoiyqxtpmxnrrbqqidcs.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testInsert() {
  const { data: users } = await supabase.from('users').select('id').limit(1);
  const userId = users?.[0]?.id;
  if (!userId) { console.error('No user found'); return; }

  const { data, error } = await supabase.from('events').insert({
    organizer_id: userId,
    title: 'Test Event',
    description: 'Test description',
    category: 'Test',
    cover_image_url: 'https://test.com/test.jpg',
    image_urls: [],
    video_urls: [],
    location_address: 'Test Address',
    location_online: false,
    online_link: null,
    lat: null,
    lng: null,
    ward: 'Test Ward',
    lga: 'Test LGA',
    state: 'Test State',
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    timezone: 'Africa/Lagos',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    payout_mode: 'POST_EVENT',
    published_at: new Date().toISOString(),
  }).select('id').single();
  
  if (error || !data) {
    console.error('Insert Error:', error);
    return;
  }
  
  console.log('Success Event Insert:', data);
  const eventId = data.id;

  const tiersToInsert = [
    {
      event_id: eventId,
      name: 'General Admission',
      description: null,
      price: 0,
      capacity: null,
      sold: 0,
      is_visible: true,
    }
  ];

  const { error: tiersError } = await supabase.from('ticket_tiers').insert(tiersToInsert);
  
  if (tiersError) {
    console.error('Ticket Tiers Insert Error:', tiersError);
  } else {
    console.log('Success Ticket Tiers Insert');
  }
}

testInsert();
