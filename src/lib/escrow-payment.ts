import { supabaseAdmin } from './supabase-admin';
import { flagPayment } from './payment-reconciliation';

/** State, sale and inventory commit together; replay cannot decrement twice. */
export async function applyEscrowPayment(transactionId: string, provider: 'payluk', reference: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('apply_escrow_payment', {
    p_transaction_id: transactionId, p_provider: provider, p_reference: reference,
  });
  if (error) {
    await flagPayment(provider, reference, transactionId, 'payment_database_error');
    throw new Error('Payment was received but requires reconciliation');
  }
  if (data === 'review') throw new Error('Payment requires reconciliation');
  return data === 'applied';
}
