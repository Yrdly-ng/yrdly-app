import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { MARKETPLACE_CONSTANTS } from '@/lib/constants';
import { PayoutService } from '@/lib/payout-service';

/**
 * POST /api/cron/auto-release
 *
 * Scheduled job that auto-completes transactions where the item
 * has been marked as shipped for more than 48 hours without the
 * buyer confirming or disputing.
 *
 * This protects sellers from unresponsive buyers who never click
 * "Confirm Receipt".
 *
 * Call via Vercel Cron (vercel.json) or Supabase pg_cron.
 * Secured by CRON_SECRET header.
 */
async function handler(request: NextRequest) {
  try {
    // ── Verify cron secret ────────────────────────────────
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const cutoffDate = new Date(
      now.getTime() - MARKETPLACE_CONSTANTS.AUTO_RELEASE_HOURS * 60 * 60 * 1000
    );

    // ── Find SHIPPED transactions older than 48h ──────────
    const { data: staleTransactions, error: fetchError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('id, buyer_id, seller_id, item_id, amount, seller_amount, shipped_at')
      .eq('status', EscrowStatus.SHIPPED)
      .lt('shipped_at', cutoffDate.toISOString());

    if (fetchError) {
      console.error('Auto-release fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    if (!staleTransactions || staleTransactions.length === 0) {
      return NextResponse.json({ message: 'No transactions to auto-release', count: 0 });
    }

    let released = 0;
    const errors: string[] = [];

    for (const tx of staleTransactions) {
      try {
        // ── Auto-complete: SHIPPED → DELIVERED → COMPLETED ──
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('escrow_transactions')
          .update({
            status: EscrowStatus.COMPLETED,
            delivered_at: now.toISOString(),
            completed_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('id', tx.id)
          .eq('status', EscrowStatus.SHIPPED) // CAS guard — only if still SHIPPED
          .select('id');

        if (updateError) {
          errors.push(`${tx.id}: ${updateError.message}`);
          continue;
        }

        // CAS guard check — if 0 rows updated another process already completed this tx
        if (!updated?.length) {
          console.log(`Auto-release: transaction ${tx.id} already completed by another process, skipping payout`);
          continue;
        }

        // ── Initiate Payout ───────────────────────────────
        try {
          await PayoutService.initiateAutoPayout(tx.id);
        } catch (payoutError) {
          console.error(`Auto-release payout initiation error for ${tx.id}:`, payoutError);
          errors.push(`${tx.id}: payout failed`);
        }

        // ── Notify both parties ───────────────────────────
        const { data: item } = await supabaseAdmin
          .from('posts')
          .select('title, text')
          .eq('id', tx.item_id)
          .single();

        const itemTitle = item?.title || item?.text || 'an item';

        // Notify seller: funds released
        await supabaseAdmin.from('notifications').insert({
          user_id: tx.seller_id,
          type: 'funds_released',
          title: 'Funds Auto-Released! 🎉',
          message: `₦${(tx.seller_amount || tx.amount).toLocaleString()} for "${itemTitle}" has been auto-released after 48 hours.`,
          related_id: tx.id,
          related_type: 'escrow_transaction',
          data: { amount: tx.seller_amount || tx.amount, itemTitle, transactionId: tx.id },
        });

        // Notify buyer: auto-completed
        await supabaseAdmin.from('notifications').insert({
          user_id: tx.buyer_id,
          type: 'delivery_confirmed',
          title: 'Transaction Auto-Completed',
          message: `Your transaction for "${itemTitle}" has been auto-completed after 48 hours. Funds have been released to the seller.`,
          related_id: tx.id,
          related_type: 'escrow_transaction',
          data: { itemTitle, transactionId: tx.id },
        });

        released++;
      } catch (txError) {
        console.error(`Auto-release error for ${tx.id}:`, txError);
        errors.push(`${tx.id}: unexpected error`);
      }
    }

    console.log(`Auto-release: ${released}/${staleTransactions.length} transactions completed`);

    return NextResponse.json({
      message: `Auto-released ${released} transactions`,
      count: released,
      total: staleTransactions.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Auto-release cron error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Vercel Cron sends GET — expose both so manual POST calls also work
export { handler as GET, handler as POST };
