import { supabase } from '@/lib/supabase';

const PAID_ESCROW_STATUSES = new Set([
  'paid', 'funds_held', 'disputed', 'shipped', 'delivered', 'completed', 'refunded',
]);

/** Fail closed before removing related content for a listing that has been paid. */
export async function assertMarketplaceListingUnpaid(itemId: string, sellerId: string): Promise<void> {
  const { data, error } = await supabase
    .from('escrow_transactions')
    .select('status, paid_at')
    .eq('item_id', itemId)
    .eq('item_type', 'post')
    .eq('seller_id', sellerId);

  if (error) throw error;
  if (data?.some((transaction) => transaction.paid_at || PAID_ESCROW_STATUSES.has(transaction.status))) {
    throw new Error('This listing cannot be deleted because it has already been paid for.');
  }
}
