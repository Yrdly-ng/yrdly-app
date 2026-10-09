import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';
import { PaylukService } from '@/lib/payluk-service';
import { EscrowStatus } from '@/types/escrow';

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
    return NextResponse.json({ error: 'Unauthorized' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });
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
    .select('id, buyer_id, seller_id, status, payluk_escrow_id, payment_provider')
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

  // 4. Idempotency — if already completed, return success without calling Payluk again.
  if (tx.status === EscrowStatus.COMPLETED) {
    return NextResponse.json({ success: true, alreadyCompleted: true });
  }

  // 5. Validate the transaction is in a confirmable state (PAID, SHIPPED, or DELIVERED).
  if (![EscrowStatus.PAID, EscrowStatus.SHIPPED, EscrowStatus.DELIVERED].includes(tx.status as EscrowStatus)) {
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
    await PaylukService.confirmDelivery(buyerPaylukId, tx.payluk_escrow_id);
  } catch (e: any) {
    const msg: string = e?.message ?? '';
    console.error('[confirm-delivery] PaylukService.confirmDelivery failed:', msg);

    const escrow = await PaylukService.verifyEscrow(tx.payluk_escrow_id).catch(() => null);
    const providerStatuses = [escrow?.status, escrow?.state].map(value => String(value || '').toLowerCase());
    if (!providerStatuses.some(value => ['completed', 'claimed'].includes(value))) {
      return NextResponse.json({ error: msg || 'Failed to confirm delivery with Payluk' }, { status: 502 });
    }

  }

  // 8. Update local DB — must not silently fail after Payluk has already released funds.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.COMPLETED,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transactionId)
    .in('status', [EscrowStatus.PAID, EscrowStatus.SHIPPED, EscrowStatus.DELIVERED])
    .select('id');

  if (updateError) {
    console.error(
      `[confirm-delivery] CRITICAL: Payluk released funds but DB update failed. ` +
      `transactionId=${transactionId} error=${updateError.message}`
    );
    // Payluk has already released — return a specific error code so mobile can surface
    // a reconciliation warning, same pattern as pay-escrow.
    return NextResponse.json({ error: 'DELIVERY_RECORDED_FAILED' }, { status: 500 });
  }
  if (!updated?.length) {
    const { data: current } = await supabaseAdmin.from('escrow_transactions').select('status').eq('id', transactionId).single();
    if (current?.status !== EscrowStatus.COMPLETED) return NextResponse.json({ error: 'Transaction state changed; reconciliation needed' }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
