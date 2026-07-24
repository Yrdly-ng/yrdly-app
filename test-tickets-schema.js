require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { error } = await supabase.from('tickets').insert({
    buyer_id: '00000000-0000-0000-0000-000000000000',
    event_id: '00000000-0000-0000-0000-000000000000',
    tier_id: '00000000-0000-0000-0000-000000000000',
    attendee_name: 'test',
    attendee_email: 'test@test.com',
    ticket_code: 'TEST',
    qr_data: 'TEST',
    status: 'PAID',
    amount_paid: 0
  });
  console.log(error);
}
run();
