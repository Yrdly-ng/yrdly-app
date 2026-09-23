import { supabaseAdmin } from '../src/lib/supabase-admin';
import { PaylukService } from '../src/lib/payluk-service';
import { getPaylukCustomerId } from '../src/lib/payluk-onboarding';
import { PayoutService } from '../src/lib/payout-service';

async function main() {
  const sellerId = 'cd54fd7f-1098-4700-b9b3-781746267f73';

  console.log('=== DIAGNOSING SELLER:', sellerId, '===');

  // 1. Fetch user record
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', sellerId)
    .single();

  console.log('User Record:', { user, userError });

  // 2. Fetch seller account
  const { data: accounts } = await supabaseAdmin
    .from('seller_accounts')
    .select('*')
    .eq('user_id', sellerId);
  console.log('Seller Accounts:', accounts);

  // 3. Fetch escrow transactions
  const { data: transactions } = await supabaseAdmin
    .from('escrow_transactions')
    .select('*')
    .eq('seller_id', sellerId);
  console.log('Escrow Transactions:', transactions);

  // 4. Fetch payout requests
  const { data: payouts } = await supabaseAdmin
    .from('payout_requests')
    .select('*')
    .eq('seller_id', sellerId);
  console.log('Payout Requests:', payouts);

  // 5. Payluk Customer ID & Wallet
  try {
    const paylukId = await getPaylukCustomerId(sellerId);
    console.log('Payluk Customer ID:', paylukId);

    if (paylukId) {
      const wallet = await PaylukService.getCustomerWallet(paylukId);
      console.log('Payluk Live Wallet Response:', wallet);
    }
  } catch (err: any) {
    console.error('Payluk Wallet Fetch Error:', err?.message || err);
  }

  // 6. Test PayoutService.getSellerBalance
  try {
    const balance = await PayoutService.getSellerBalance(sellerId);
    console.log('PayoutService.getSellerBalance Result:', balance);
  } catch (err: any) {
    console.error('getSellerBalance Error:', err?.message || err);
  }
}

main().catch(console.error);
