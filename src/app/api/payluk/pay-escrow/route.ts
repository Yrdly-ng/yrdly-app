import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';
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
  console.log('[pay-escrow] transactionId:', transactionId, 'caller:', user.id);

  const { data: tx, error: txFetchError } = await supabaseAdmin
    .from('escrow_transactions')
    .select('id, buyer_id, total_amount, status, payluk_tx_ref, payluk_escrow_id, item_id, item_type')
    .eq('id', transactionId)
    .single();

  if (txFetchError || !tx) {
    console.log('[pay-escrow] transaction not found. error:', txFetchError?.message);
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  console.log('[pay-escrow] tx row:', JSON.stringify({ id: tx.id, status: tx.status, total_amount: tx.total_amount, payluk_tx_ref: tx.payluk_tx_ref, payluk_escrow_id: tx.payluk_escrow_id }));

  if (!tx.payluk_escrow_id) {
    return NextResponse.json({ error: 'Transaction has no associated Payluk escrow' }, { status: 409 });
  }

  // 2. Verify the caller is the buyer.
  if (tx.buyer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 3. Guard against double-payment: Return success if already paid (idempotent result)
  if (tx.status === EscrowStatus.PAID || tx.status === EscrowStatus.COMPLETED) {
    return NextResponse.json({ success: true, message: 'Transaction already paid' });
  }

  // 4. ATOMIC COMPARE-AND-SWAP CLAIM: pending -> processing
  // Only ONE concurrent request successfully claims the transaction row.
  // Sets processing_started_at timestamp for lock-age tracking.
  const nowIso = new Date().toISOString();
  let activeClaimedTx: any = null;

  const { data: claimedTx, error: claimErr } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: 'processing',
      processing_started_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', transactionId)
    .eq('status', EscrowStatus.PENDING)
    .select('id, buyer_id, total_amount, status, payluk_tx_ref, payluk_escrow_id, item_id, item_type')
    .single();

  if (claimedTx) {
    activeClaimedTx = claimedTx;
  } else {
    console.log('[pay-escrow] Atomic claim failed or row already processing. Fetching status & lock age...');
    const { data: currentTx } = await supabaseAdmin
      .from('escrow_transactions')
      .select('id, buyer_id, total_amount, status, payluk_tx_ref, payluk_escrow_id, item_id, item_type, processing_started_at, updated_at')
      .eq('id', transactionId)
      .single();

    if (!currentTx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (currentTx.status === EscrowStatus.PAID || currentTx.status === EscrowStatus.COMPLETED) {
      return NextResponse.json({ success: true, message: 'Transaction already paid' });
    }

    if (currentTx.status === 'reconciling') {
      return NextResponse.json(
        { error: 'RECONCILIATION_IN_PROGRESS', message: 'Reconciliation is currently in progress. Please try again shortly.' },
        { status: 409 }
      );
    }

    if (currentTx.status === 'processing') {
      const lockTimestamp = currentTx.processing_started_at || currentTx.updated_at;
      const lockAgeMs = Date.now() - new Date(lockTimestamp).getTime();
      const LOCK_TIMEOUT_MS = 60 * 1000; // 60 seconds

      if (lockAgeMs < LOCK_TIMEOUT_MS) {
        return NextResponse.json(
          { error: 'PAYMENT_PROCESSING_IN_PROGRESS', message: 'Payment is currently being processed. Please wait.' },
          { status: 409 }
        );
      }

      // ── STALE LOCK DETECTED (Age >= 60 seconds) ──
      // Perform ATOMIC STALE-LOCK CLAIM: processing -> reconciling
      // Only ONE request wins the reconciling claim and calls Payluk status API!
      console.warn(`[pay-escrow] Stale processing lock detected (age: ${Math.round(lockAgeMs / 1000)}s). Claiming atomic reconciliation lock...`);
      
      const { data: reconcilingTx, error: reconcileClaimErr } = await supabaseAdmin
        .from('escrow_transactions')
        .update({
          status: 'reconciling',
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId)
        .eq('status', 'processing')
        .select('id, buyer_id, total_amount, status, payluk_tx_ref, payluk_escrow_id, item_id, item_type')
        .single();

      if (reconcileClaimErr || !reconcilingTx) {
        return NextResponse.json(
          { error: 'RECONCILIATION_IN_PROGRESS', message: 'Another request is currently reconciling this stale lock.' },
          { status: 409 }
        );
      }

      // Winner of the atomic reconciling claim performs provider status lookup
      try {
        const customerId = await getPaylukCustomerId(user.id);
        console.log(`[pay-escrow] Reconciling stale lock with Payluk for escrowId: ${currentTx.payluk_escrow_id}...`);
        
        const paylukEscrow = await PaylukService.getEscrowDetails(customerId, currentTx.payluk_escrow_id);
        console.log('[pay-escrow] Payluk escrow details retrieved:', JSON.stringify({ status: paylukEscrow.status, state: paylukEscrow.state, paidAt: paylukEscrow.paidAt }));

        // Evaluate provider status semantics:
        const isFundedOnProvider = paylukEscrow.paidAt !== null || 
                                   paylukEscrow.state === 'OPENED' || 
                                   ['ONGOING', 'COMPLETED', 'CLAIMED', 'DISPUTED'].includes(paylukEscrow.status);

        const isDefinitivelyUnfunded = paylukEscrow.state === 'AWAITING_PAYMENT' && 
                                       paylukEscrow.paidAt === null && 
                                       paylukEscrow.status === 'PENDING';

        if (isFundedOnProvider) {
          console.log('[pay-escrow] Stale lock reconciliation: Provider confirms payment was FUNDED. Updating local state to PAID...');
          await supabaseAdmin
            .from('escrow_transactions')
            .update({
              status: EscrowStatus.PAID,
              paid_at: paylukEscrow.paidAt || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', transactionId);

          if (currentTx.item_type === 'catalog_item') {
            await supabaseAdmin.from('catalog_items').update({ in_stock: false, updated_at: new Date().toISOString() }).eq('id', currentTx.item_id);
          } else {
            await supabaseAdmin.from('posts').update({ is_sold: true, sold_to_user_id: currentTx.buyer_id, sold_at: new Date().toISOString(), transaction_id: transactionId }).eq('id', currentTx.item_id);
          }

          return NextResponse.json({ success: true, message: 'Transaction reconciled as paid' });
        } else if (isDefinitivelyUnfunded) {
          console.log('[pay-escrow] Stale lock reconciliation: Provider confirms escrow is UNFUNDED. Safely resetting lock to PENDING...');
          // Safely reset lock to pending so this winner request can proceed to pay!
          const { data: resetTx } = await supabaseAdmin
            .from('escrow_transactions')
            .update({
              status: 'processing',
              processing_started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', transactionId)
            .select('*')
            .single();

          if (!resetTx) {
            return NextResponse.json({ error: 'Failed to claim reset transaction lock' }, { status: 500 });
          }
          activeClaimedTx = resetTx;
        } else {
          console.warn('[pay-escrow] Payluk status ambiguous during reconciliation. Transitioning status to reconciliation_required...');
          await supabaseAdmin
            .from('escrow_transactions')
            .update({ status: 'reconciliation_required', updated_at: new Date().toISOString() })
            .eq('id', transactionId);

          return NextResponse.json({ error: 'RECONCILIATION_REQUIRED', message: 'Payluk status is ambiguous. Please contact support.' }, { status: 409 });
        }
      } catch (reconcileErr: any) {
        console.error('[pay-escrow] Error during Payluk getEscrowDetails lookup:', reconcileErr);
        await supabaseAdmin
          .from('escrow_transactions')
          .update({ status: 'reconciliation_required', updated_at: new Date().toISOString() })
          .eq('id', transactionId);

        return NextResponse.json({ error: 'RECONCILIATION_REQUIRED', message: 'Failed to verify Payluk status.' }, { status: 500 });
      }
    } else {
      return NextResponse.json(
        { error: 'Transaction is not in a payable state', status: currentTx?.status || 'unknown' },
        { status: 400 }
      );
    }
  }

  try {
    const customerId = await getPaylukCustomerId(user.id);
    console.log('[pay-escrow] buyer customerId:', customerId, 'calling payEscrow with escrowId:', activeClaimedTx.payluk_escrow_id, 'amount:', activeClaimedTx.total_amount);

    // 5. Call Payluk — winner only! Both amount and escrowId come from the database row.
    let isAlreadyPaidOnProvider = false;
    try {
      await PaylukService.payEscrow(customerId, {
        amount: activeClaimedTx.total_amount,
        reference: transactionId, // stable internal ID used as unique provider payment reference
        escrowId: activeClaimedTx.payluk_escrow_id,
        gateway: 'wallet',
      });
      console.log('[pay-escrow] Payluk payEscrow succeeded');
    } catch (payError: any) {
      const payMsg = (payError?.message || '').toLowerCase();
      // Handle provider idempotency: If Payluk reports escrow was already paid/funded/completed, proceed to reconcile
      if (payMsg.includes('already paid') || payMsg.includes('already funded') || payMsg.includes('already completed') || payMsg.includes('duplicate reference')) {
        console.log('[pay-escrow] Payluk reports escrow already paid/funded. Reconciling local state to PAID...');
        isAlreadyPaidOnProvider = true;
      } else {
        // Re-throw to error handler below
        throw payError;
      }
    }

    // 6. Update transaction status to PAID.
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
        `transactionId=${transactionId} payluk_tx_ref=${activeClaimedTx.payluk_tx_ref} error=${updateError.message}`
      );
      // Mark as reconciliation_required to prevent blind retries
      await supabaseAdmin
        .from('escrow_transactions')
        .update({ status: 'reconciliation_required', updated_at: new Date().toISOString() })
        .eq('id', transactionId);

      return NextResponse.json(
        { error: 'PAYMENT_RECORDED_FAILED', paylukSucceeded: true },
        { status: 500 }
      );
    }

    if (activeClaimedTx.item_type === 'catalog_item') {
      await supabaseAdmin
        .from('catalog_items')
        .update({ 
          in_stock: false, 
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeClaimedTx.item_id);
    } else {
      await supabaseAdmin
        .from('posts')
        .update({ 
          is_sold: true, 
          sold_to_user_id: activeClaimedTx.buyer_id,
          sold_at: new Date().toISOString(),
          transaction_id: transactionId,
        })
        .eq('id', activeClaimedTx.item_id);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const msg: string = err?.message ?? 'Payment failed';

    // Handle definitive vs ambiguous errors:
    // Definitive failures (insufficient balance, unverified phone): Safe to revert status back to 'pending' for buyer retry
    const isDefinitiveFailure = msg.toLowerCase().includes('insufficient balance') || msg.includes('must have a verified phone number');

    if (isDefinitiveFailure) {
      console.log('[pay-escrow] Definitive failure detected. Reverting status from processing to pending...');
      await supabaseAdmin
        .from('escrow_transactions')
        .update({ status: EscrowStatus.PENDING, updated_at: new Date().toISOString() })
        .eq('id', transactionId);
    } else {
      // Ambiguous error (network timeout, 502): Set status to reconciliation_required to block duplicate debits
      console.warn('[pay-escrow] Ambiguous error detected. Setting status to reconciliation_required to prevent duplicate debits...');
      await supabaseAdmin
        .from('escrow_transactions')
        .update({ status: 'reconciliation_required', updated_at: new Date().toISOString() })
        .eq('id', transactionId);
    }

    if (msg.includes('must have a verified phone number')) {
      return NextResponse.json({ error: 'PHONE_VERIFICATION_REQUIRED' }, { status: 409 });
    }

    // Payluk returns exactly "Insufficient balance" when the wallet is short.
    if (msg.toLowerCase().includes('insufficient balance')) {
      return NextResponse.json({ error: 'INSUFFICIENT_BALANCE' }, { status: 402 });
    }

    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
