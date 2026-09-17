import { supabaseAdmin } from './src/lib/supabase-admin';

async function testInsert() {
  const { data, error } = await supabaseAdmin
    .from('events')
    .insert({
      organizer_id: '00000000-0000-0000-0000-000000000000', // Dummy UUID
      title: 'Test Event',
      category: 'General',
      location_online: false,
      start_time: new Date().toISOString(),
      timezone: 'Africa/Lagos',
      status: 'DRAFT',
      visibility: 'PUBLIC',
      payout_mode: 'POST_EVENT'
    })
    .select('id')
    .single();

  if (error) {
    console.error('Insert error:', error);
  } else {
    console.log('Inserted successfully:', data);
  }
}

testInsert();
