import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ensurePaylukCustomer } from '@/lib/payluk-onboarding';
import { PaylukService } from '@/lib/payluk-service';
import { EscrowStatus } from '@/types/escrow';

/**
 * POST /api/payluk/claim-funds
 *
 * Called by the seller to request fund release after the delivery window elapses
 * without buyer confirmation. Calls Payluk's GET /v1/escrow/claim-funds/{paymentToken}
 * (requires seller's customer-id header). Payluk will 400 if the window hasn't elapsed yet.
 *
 * Body: { transactionId: string }
 *
 * Only the authenticated seller of this transaction may call this route.
 */
export async function POST(request: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let transactionId: string;
  try {
    ({ transactionId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!transactionId) {
    return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
  }

  // 1. Load the transaction — payluk_tx_ref is the paymentToken (PY_...) claimFunds requires.
  const { data: tx, error: fetchError } = await supabaseAdmin
    .from('escrow_transactions')
    .select('id, buyer_id, seller_id, status, payluk_tx_ref, payment_provider')
    .eq('id', transactionId)
    .maybeSingle();

  if (fetchError || !tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  // 2. Ownership check — only the seller can claim.
  if (tx.seller_id !== user.id) {
    return NextResponse.json({ error: 'Only the seller can claim funds' }, { status: 403 });
  }

  // 3. Validate Payluk transaction.
  if (tx.payment_provider !== 'payluk') {
    return NextResponse.json({ error: 'Transaction is not a Payluk payment' }, { status: 400 });
  }
  if (!tx.payluk_tx_ref) {
    return NextResponse.json({ error: 'Payluk payment token not found for this transaction' }, { status: 400 });
  }

  // 4. Idempotency.
  if (tx.status === EscrowStatus.COMPLETED) {
    return NextResponse.json({ success: true, alreadyCompleted: true });
  }

  // 5. Must be in PAID state for the claim to be meaningful.
  //    Payluk will reject with 400 if the delivery window hasn't elapsed yet —
  //    we surface that message directly to the caller.
  if (tx.status !== EscrowStatus.PAID) {
    return NextResponse.json(
      { error: `Transaction cannot be claimed in state: ${tx.status}` },
      { status: 400 }
    );
  }

  // 6. Resolve the seller's Payluk customer ID.
  let sellerPaylukId: string;
  try {
    sellerPaylukId = await ensurePaylukCustomer(user.id);
  } catch (e: any) {
    const msg: string = e?.message ?? '';
    if (msg === 'PHONE_VERIFICATION_REQUIRED') {
      return NextResponse.json({ error: 'PHONE_VERIFICATION_REQUIRED' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to resolve Payluk customer' }, { status: 500 });
  }

  // 7. Call Payluk — payluk_tx_ref is the paymentToken that claimFunds expects.
  try {
    await PaylukService.claimFunds(sellerPaylukId, tx.payluk_tx_ref);
  } catch (e: any) {
    const msg: string = e?.message ?? '';
    console.error('[claim-funds] PaylukService.claimFunds failed:', msg);
    // Payluk returns 400 with "Escrow cannot be claimed yet" if window hasn't elapsed.
    // Surface the Payluk message directly so mobile can display it.
    return NextResponse.json({ error: msg || 'Failed to claim funds from Payluk' }, { status: 502 });
  }

  // 8. Update local DB.
  const { error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.COMPLETED,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transactionId)
    .eq('status', EscrowStatus.PAID);

  if (updateError) {
    console.error(
      `[claim-funds] CRITICAL: Payluk claim succeeded but DB update failed. ` +
      `transactionId=${transactionId} error=${updateError.message}`
    );
    return NextResponse.json({ error: 'CLAIM_RECORDED_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
