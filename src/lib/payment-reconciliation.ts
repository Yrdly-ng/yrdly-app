import { supabaseAdmin } from './supabase-admin';

export async function flagPayment(provider: string, reference: string, transactionId: string | null, reason: string) {
  const { error } = await supabaseAdmin.from('payment_reconciliation_flags').upsert({
    provider, reference, transaction_id: transactionId, reason,
  }, { onConflict: 'provider,reference,reason', ignoreDuplicates: true });
  if (error) throw new Error('Could not persist payment reconciliation flag');
}
