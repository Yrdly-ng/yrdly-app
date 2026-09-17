import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PaylukService } from '@/lib/payluk-service';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';

/**
 * POST /api/admin/release-stuck-escrows
 *
 * One-time recovery route for Payluk transactions that are COMPLETED in our DB
 * but were never confirmed on Payluk's side (funds still locked in escrow).
 *
 * Protected by ADMIN_SECRET header — delete this file after use.
 *
 * Optional body: { dryRun: true } — inspect without making any changes.
 */
export async function POST(request: NextRequest) {
  // ── Admin auth ────────────────────────────────────────────────────────────
  const secret = request.headers.get('x-admin-secret');
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let dryRun = false;
  try {
    const body = await request.json().catch(() => ({}));
    dryRun = body?.dryRun === true;
  } catch { /* no body */ }

  // ── Find stuck transactions ───────────────────────────────────────────────
  // Criteria: payment_provider=payluk, has a payluk_escrow_id,
  //           status=COMPLETED (buyer confirmed in app) but escrow not yet released.
  const { data: txns, error: fetchError } = await supabaseAdmin
    .from('escrow_transactions')
    .select('id, buyer_id, seller_id, payluk_escrow_id, payluk_tx_ref, status, completed_at')
    .eq('payment_provider', 'payluk')
    .in('status', ['completed', 'delivered'])
    .not('payluk_escrow_id', 'is', null);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const results: {
    transactionId: string;
    paylukEscrowId: string;
    paylukState: string;
    action: string;
    error?: string;
  }[] = [];

  for (const tx of txns ?? []) {
    const entry: (typeof results)[number] = {
      transactionId: tx.id,
      paylukEscrowId: tx.payluk_escrow_id,
      paylukState: 'unknown',
      action: 'none',
    };

    try {
      // 1. Use payluk_tx_ref (payment token) to check state via verifyEscrow
      //    payluk_escrow_id is the internal ID used for confirmDelivery
      const paymentToken = tx.payluk_tx_ref;

      if (paymentToken) {
        const escrow = await PaylukService.verifyEscrow(paymentToken);
        entry.paylukState = `state=${escrow.state} status=${escrow.status}`;

        const needsRelease =
          escrow.state === 'OPENED' &&
          (escrow.status === 'ONGOING' || escrow.status === 'PENDING');

        if (!needsRelease) {
          entry.action = 'skipped — already released or not funded';
          results.push(entry);
          continue;
        }
      } else {
        // No payment token stored — skip the state check, attempt release directly
        entry.paylukState = 'unknown (no payluk_tx_ref stored)';
      }

      if (dryRun) {
        entry.action = 'DRY_RUN — would call confirmDelivery';
        results.push(entry);
        continue;
      }

      // 2. Get buyer's Payluk customer ID (required by confirm-payment endpoint)
      const buyerPaylukId = await getPaylukCustomerId(tx.buyer_id);

      // 3. Call Payluk confirm-payment — this releases funds to the seller's wallet
      await PaylukService.confirmDelivery(buyerPaylukId, tx.payluk_escrow_id);
      entry.action = '✅ confirmDelivery called — funds released to seller';

    } catch (err: any) {
      const msg: string = err?.message ?? 'unknown error';

      // "Action not allowed" = escrow already closed on Payluk side — treat as OK
      if (msg.includes('Action not allowed')) {
        entry.action = '✅ already closed on Payluk — no action needed';
      } else {
        entry.action = `❌ FAILED: ${msg}`;
        entry.error = msg;
      }
    }

    results.push(entry);
  }

  const released = results.filter(r => r.action.startsWith('✅')).length;
  const failed   = results.filter(r => r.action.startsWith('❌')).length;
  const skipped  = results.filter(r => r.action.startsWith('skipped')).length;

  return NextResponse.json({
    dryRun,
    total: results.length,
    released,
    failed,
    skipped,
    results,
  });
}
