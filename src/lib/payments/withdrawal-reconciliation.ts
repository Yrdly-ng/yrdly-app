import { supabaseAdmin } from '../supabase/supabase-admin';
import { PaylukService } from './payluk-service';

/** Reads one submitted withdrawal. Never creates, verifies, or retries a transfer. */
export async function reconcileDelayedWithdrawal(): Promise<string> {
  const { data: payout, error } = await supabaseAdmin.rpc('claim_delayed_withdrawal_check');
  if (error) throw error;
  if (!payout) return 'idle';
  let result: Awaited<ReturnType<typeof PaylukService.getWithdrawalDetails>> = { outcome: 'pending' };
  try {
    const { data: user, error: userError } = await supabaseAdmin.from('users')
      .select('payluk_customer_id').eq('id', payout.seller_id).single();
    if (!userError && user?.payluk_customer_id) {
      result = await PaylukService.getWithdrawalDetails(user.payluk_customer_id, payout.transaction_reference);
    }
  } catch {
    // Provider unavailability cannot authorize release or a second transfer.
  }
  if (result.outcome === 'failed' || (result.outcome === 'success' && result.debit && result.debit <= Number(payout.amount))) {
    const { data, error: saveError } = await supabaseAdmin.from('payout_requests').update({
      status: result.outcome === 'success' ? 'completed' : 'failed',
      ...(result.outcome === 'success' ? { amount: result.debit } : {}),
      processed_at: new Date().toISOString(),
      failure_reason: result.outcome === 'success' ? null : 'Payluk confirmed this withdrawal failed. Funds are available for a seller-requested withdrawal.',
    }).eq('id', payout.id).eq('status', 'processing').eq('execution_stage', 'submitted')
      .eq('transaction_reference', payout.transaction_reference).select('id');
    if (saveError) throw saveError;
    return data?.length ? result.outcome : 'changed';
  }
  const { error: alertError } = await supabaseAdmin.rpc('alert_delayed_withdrawal', {
    p_payout_id: payout.id, p_reference: payout.transaction_reference,
  });
  if (alertError) throw alertError;
  return 'pending-review';
}
