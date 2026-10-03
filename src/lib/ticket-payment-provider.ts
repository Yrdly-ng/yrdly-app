import { supabaseAdmin } from './supabase-admin';

export async function isPaylukTicket(paymentTxRef: string | null): Promise<boolean> {
  if (!paymentTxRef) return false;
  const isEscrowId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentTxRef);
  if (!isEscrowId) return false;
  const { data, error } = await supabaseAdmin
    .from('escrow_transactions')
    .select('payment_provider')
    .eq('id', paymentTxRef)
    .maybeSingle();
  if (error) throw error;
  // Paystack ticket references are evt-*; Payluk tickets store the UUID of
  // their escrow_transactions row. Treat an orphaned UUID as Payluk to fail safe.
  return data?.payment_provider === 'payluk' || !data;
}
