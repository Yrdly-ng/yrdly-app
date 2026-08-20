import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ensurePaylukCustomer } from '@/lib/payluk-onboarding';
import { PaylukService } from '@/lib/payluk-service';
import { EscrowStatus } from '@/types/escrow';

/**
 * POST /api/payluk/pay-escrow
 *
 * Funds an existing escrow from the buyer's Payluk wallet.
 * Body: { transactionId: string }
 *   - transactionId: Our internal escrow_transactions.id. The Payluk escrow ID
 *     is read from the stored payluk_tx_ref column — never from client input.
 *
 * Amount is always read from escrow_transactions.total_amount — it is never
 * recalculated here. This is intentional: the amount was validated and stored at
 * escrow-creation time (payment/initialize), so re-deriving it would risk drift.
 *
 * On success: escrow_transactions row is updated to PAID.
 * On insufficient balance: returns { error: 'INSUFFICIENT_BALANCE' } with 402.
 */
export async function POST(request: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { transactionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { transactionId } = body;
  if (!transactionId) {
    return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
  }

  // 1. Pull the transaction row — total_amount and payluk_tx_ref are stored at creation time.
  //    payluk_tx_ref is used as the escrow ID for the Payluk call; the client
  //    does not supply this value and cannot influence which escrow gets paid.
  const { data: tx, error: txFetchError } = await supabaseAdmin
    .from('escrow_transactions')
    .select('id, buyer_id, total_amount, status, payluk_tx_ref')
    .eq('id', transactionId)
    .single();

  if (txFetchError || !tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  if (!tx.payluk_tx_ref) {
    return NextResponse.json({ error: 'Transaction has no associated Payluk escrow' }, { status: 409 });
  }

  // 2. Verify the caller is the buyer.
  if (tx.buyer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 3. Guard against double-payment.
  if (tx.status === EscrowStatus.PAID) {
    return NextResponse.json({ error: 'Transaction already paid' }, { status: 409 });
  }

  try {
    const customerId = await ensurePaylukCustomer(user.id);

    // 4. Call Payluk — both amount and escrowId come from the database row,
    //    never from client input.
    await PaylukService.payEscrow(customerId, {
      amount: tx.total_amount,
      reference: transactionId, // our internal ID doubles as the unique payment reference
      escrowId: tx.payluk_tx_ref,
      gateway: 'wallet',
    });

    // 5. Update transaction status to PAID.
    //    IMPORTANT: Payluk has already debited the buyer's wallet by this point.
    //    If this update fails, funds have moved but our record is inconsistent —
    //    this requires manual reconciliation. Log loudly; do not silently succeed.
    const { error: updateError } = await supabaseAdmin
      .from('escrow_transactions')
      .update({
        status: EscrowStatus.PAID,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId);

    if (updateError) {
      console.error(
        `[pay-escrow] RECONCILIATION REQUIRED: Payluk payment succeeded but DB update failed. ` +
        `transactionId=${transactionId} payluk_tx_ref=${tx.payluk_tx_ref} error=${updateError.message}`
      );
      // Return 500 — the payment succeeded on Payluk's side but our state is inconsistent.
      // Mobile should surface this as "payment processed, please contact support" rather than retrying.
      return NextResponse.json(
        { error: 'PAYMENT_RECORDED_FAILED', paylukSucceeded: true },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const msg: string = err?.message ?? 'Payment failed';

    if (msg.includes('must have a verified phone number')) {
      return NextResponse.json({ error: 'PHONE_VERIFICATION_REQUIRED' }, { status: 409 });
    }

    // Payluk returns "Insufficient balance" (or similar) when the wallet is short.
    if (msg.toLowerCase().includes('insufficient') || msg.toLowerCase().includes('balance')) {
      return NextResponse.json({ error: 'INSUFFICIENT_BALANCE' }, { status: 402 });
    }

    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
