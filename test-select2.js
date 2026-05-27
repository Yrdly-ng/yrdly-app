import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: transaction, error: fetchError } = await supabaseAdmin
          .from('escrow_transactions')
          .select(`
            buyer_id,
            seller_id,
            amount,
            item:posts(title, text)
          `)
          .eq('id', '45f01686-4b91-4248-aea1-90b27765d872')
          .single();

  console.log('Error:', fetchError);
}
main();
