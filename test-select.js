import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: dispute, error: disputeError } = await supabaseAdmin
    .from('disputes')
    .select(`
      *,
      transaction:escrow_transactions(
        id,
        buyer_id,
        seller_id,
        item:posts(title, text)
      ),
      user:users!opened_by(email, name)
    `)
    .eq('id', '77fd7f7e-4bb8-47c7-8d24-5971678a4f8d')
    .single();

  console.log('Error:', disputeError);
  console.log('Data:', JSON.stringify(dispute, null, 2));
}
main();
