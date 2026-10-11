import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PaylukService } from '@/lib/payluk-service';
import { applyDisputeSettlement } from '@/lib/dispute-settlement';

const reconcileSchema = z.object({
  outcome: z.enum(['applied', 'not_applied']),
  providerReference: z.string().trim().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ disputeId: string }> },
) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const parsed = reconcileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Select a verified provider outcome.' }, { status: 400 });
  const { disputeId } = await context.params;
  const { data: dispute } = await supabaseAdmin.from('disputes').select('transaction_id').eq('id', disputeId).single();
  const { data: transaction } = dispute
    ? await supabaseAdmin.from('escrow_transactions').select('id,payluk_tx_ref,payment_provider').eq('id', dispute.transaction_id).single()
    : { data: null };
  if (!transaction?.payluk_tx_ref || transaction.payment_provider !== 'payluk') return NextResponse.json({ error: 'A saved Payluk payment token is required.' }, { status: 409 });
  try {
    const verified = await PaylukService.verifyEscrow(transaction.payluk_tx_ref);
    if (parsed.data.outcome === 'applied') {
      if (!await applyDisputeSettlement(transaction.id, verified)) throw new Error('Resolution operation is missing.');
      return NextResponse.json({ success: true, status: 'succeeded' });
    }
    if (!['DISPUTED', 'INVESTIGATING'].includes(verified.status)) throw new Error('Payluk does not confirm an unresolved dispute.');
  } catch {
    return NextResponse.json({ error: 'Payluk outcome could not be verified. Keep this operation blocked for reconciliation.' }, { status: 409 });
  }
  const { data: status, error: reconcileError } = await supabaseAdmin.rpc('reconcile_dispute_resolution', {
    p_dispute_id: disputeId,
    p_admin_id: user.id,
    p_outcome: parsed.data.outcome,
    p_provider_reference: parsed.data.providerReference || null,
  });
  if (reconcileError) {
    console.error('[ReconcileDispute] Reconciliation failed:', reconcileError);
    return NextResponse.json({ error: reconcileError.message || 'Could not reconcile payment operation.' }, { status: 409 });
  }
  return NextResponse.json({ success: true, status });
}
