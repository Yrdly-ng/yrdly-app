require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('escrow_transactions').select('id, seller_id, seller:users!escrow_transactions_seller_id_fkey(id, name, avatar_url), item:posts(id, title, image_urls)').limit(1);
  console.log(error);
}
run();
