import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';
import { PaylukService } from '@/lib/payluk-service';
import { EscrowStatus } from '@/types/escrow';
import { PayoutService } from '@/lib/payout-service';

/**
 * POST /api/payluk/confirm-delivery
 *
 * Called by the buyer to confirm they have received the item.
 * Calls Payluk's POST /v1/escrow/confirm-payment/{escrowId} (requires buyer's customer-id header),
 * which releases the full escrow amount to the seller and marks the escrow COMPLETED on Payluk's side.
 * On success, updates the local escrow_transactions row to COMPLETED.
 *
 * Body: { transactionId: string }
 *
 * Only the authenticated buyer of this transaction may call this route.
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

  // 1. Load the transaction — all values come from the DB, not from the client.
  const { data: tx, error: fetchError } = await supabaseAdmin
    .from('escrow_transactions')
    .select('id, buyer_id, seller_id, status, payluk_escrow_id, payluk_payment_token, payment_provider')
    .eq('id', transactionId)
    .maybeSingle();

  if (fetchError || !tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  // 2. Ownership check — only the buyer can confirm delivery.
  if (tx.buyer_id !== user.id) {
    return NextResponse.json({ error: 'Only the buyer can confirm delivery' }, { status: 403 });
  }

  // 3. Validate this is a Payluk transaction with a stored escrow ID.
  if (tx.payment_provider !== 'payluk') {
    return NextResponse.json({ error: 'Transaction is not a Payluk payment' }, { status: 400 });
  }
  if (!tx.payluk_escrow_id) {
    return NextResponse.json({ error: 'Payluk escrow ID not found for this transaction' }, { status: 400 });
  }

  // 4. Never trust a local COMPLETED flag by itself. A previous bug could update
  // the app before Payluk released the escrow, so verify/release against Payluk first.
  // This also makes retries safe when the remote escrow is already closed.

  // 5. Validate the transaction is in a confirmable state.
  if (![EscrowStatus.PAID, EscrowStatus.SHIPPED, EscrowStatus.DELIVERED, EscrowStatus.COMPLETED].includes(tx.status as EscrowStatus)) {
    return NextResponse.json(
      { error: `Transaction cannot be confirmed in state: ${tx.status}` },
      { status: 400 }
    );
  }

  // 6. Resolve the buyer's Payluk customer ID.
  let buyerPaylukId: string;
  try {
    buyerPaylukId = await getPaylukCustomerId(user.id);
  } catch (e: any) {
    const msg: string = e?.message ?? '';
    if (msg === 'PHONE_VERIFICATION_REQUIRED') {
      return NextResponse.json({ error: 'PHONE_VERIFICATION_REQUIRED' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to resolve Payluk customer' }, { status: 500 });
  }

  // 7. Call Payluk — this releases funds to the seller on Payluk's side.
  try {
    const releasedEscrow = await PaylukService.confirmDelivery(buyerPaylukId, tx.payluk_escrow_id);
    if (!['COMPLETED', 'CLAIMED'].includes(releasedEscrow.status)) {
      console.error(
        `[confirm-delivery] Payluk accepted the request without releasing escrow. ` +
        `transactionId=${transactionId} remoteStatus=${releasedEscrow.status} remoteState=${releasedEscrow.state}`
      );
      return NextResponse.json(
        { error: 'Payluk has not released the escrow funds yet' },
        { status: 409 }
      );
    }
  } catch (e: any) {
    const msg: string = e?.message ?? '';
    console.error('[confirm-delivery] PaylukService.confirmDelivery failed:', msg);

    // Payluk may reject a retry because the escrow is already closed. Verify the
    // remote state before treating that as success; a local flag is not proof.
    if (msg.includes('Action not allowed') && tx.payluk_payment_token) {
      try {
        const remoteEscrow = await PaylukService.verifyEscrow(tx.payluk_payment_token);
        if (['COMPLETED', 'CLAIMED'].includes(remoteEscrow.status)) {
          const { error: reconcileError } = await supabaseAdmin
            .from('escrow_transactions')
            .update({
              status: EscrowStatus.COMPLETED,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', transactionId);

          if (reconcileError) {
            console.error('[confirm-delivery] Remote release verified but reconciliation failed:', reconcileError);
            return NextResponse.json({ error: 'DELIVERY_RECORDED_FAILED' }, { status: 500 });
          }
          return NextResponse.json({ success: true, alreadyCompleted: true });
        }
      } catch (verifyError) {
        console.error('[confirm-delivery] Could not verify Payluk after rejected retry:', verifyError);
      }
    }

    return NextResponse.json(
      { error: msg || 'Failed to confirm delivery with Payluk' },
      { status: 502 }
    );
  }

  // 8. Update local DB — must not silently fail after Payluk has already released funds.
  const { error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.COMPLETED,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transactionId)
    .in('status', [EscrowStatus.PAID, EscrowStatus.SHIPPED, EscrowStatus.DELIVERED, EscrowStatus.COMPLETED]); // optimistic-lock: allow reconciliation of an older local false-completion

  if (updateError) {
    console.error(
      `[confirm-delivery] CRITICAL: Payluk released funds but DB update failed. ` +
      `transactionId=${transactionId} error=${updateError.message}`
    );
    // Payluk has already released — return a specific error code so mobile can surface
    // a reconciliation warning, same pattern as pay-escrow.
    return NextResponse.json({ error: 'DELIVERY_RECORDED_FAILED' }, { status: 500 });
  }

  // Payluk has released the escrow and the local transaction is now completed.
  // Start the seller payout from this same delivery-confirmation path as well as
  // the legacy /transactions/:id/complete path. The payout service is idempotent
  // at the provider reference level; a failure here must not undo the escrow
  // release, but it must be visible to the caller so the seller can retry.
  let payoutInitiated = false;
  try {
    await PayoutService.initiateAutoPayout(transactionId);
    payoutInitiated = true;
  } catch (payoutError) {
    console.error('[confirm-delivery] Seller payout initiation failed:', payoutError);
  }

  return NextResponse.json({
    success: true,
    payoutInitiated,
    payoutRequired: !payoutInitiated,
  });
}
