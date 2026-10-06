import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PaystackService } from '@/lib/paystack-service';
import { PayoutService } from '@/lib/payout-service';
import { NotificationService } from '@/lib/notification-service';
import { PaylukService } from '@/lib/payluk-service';

const resolveSchema = z.object({
  resolution: z.string().trim().min(1).max(1000),
  refundAmount: z.number().finite().nonnegative(),
  sellerAmount: z.number().finite().nonnegative(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ disputeId: string }> },
) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Provide a resolution and non-negative numeric amounts.' }, { status: 400 });
  }

  const { disputeId } = await context.params;
  const requested = parsed.data;
  const { data: claim, error: claimError } = await supabaseAdmin.rpc('begin_dispute_resolution', {
    p_dispute_id: disputeId,
    p_admin_id: user.id,
    p_resolution: requested.resolution,
    p_refund_amount: requested.refundAmount,
    p_seller_amount: requested.sellerAmount,
  });
  if (claimError || !claim?.operation) {
    console.error('[ResolveDispute] Could not claim resolution:', claimError);
    return NextResponse.json({ error: claimError?.message || 'Could not start dispute resolution.' }, { status: 400 });
  }

  const operation = claim.operation;
  if (!claim.newly_created) {
    if (operation.status === 'succeeded') return NextResponse.json({ success: true, idempotent: true });
    return NextResponse.json(
      { error: 'A resolution attempt already exists. Check its status before taking further action.', resolutionStatus: operation.status },
      { status: 409 },
    );
  }

  // Retries always use the originally claimed payload, never a modified UI payload.
  const resolution = operation.resolution as string;
  const refundAmount = Number(operation.refund_amount);
  const sellerAmount = Number(operation.seller_amount);

  const { data: dispute, error: disputeError } = await supabaseAdmin
    .from('disputes')
    .select('transaction_id')
    .eq('id', disputeId)
    .single();
  const { data: transaction, error: transactionError } = dispute
    ? await supabaseAdmin.from('escrow_transactions').select('*').eq('id', dispute.transaction_id).single()
    : { data: null, error: disputeError };
  if (disputeError || transactionError || !transaction) {
    await supabaseAdmin.rpc('flag_dispute_resolution_reconciliation', {
      p_operation_id: operation.id,
      p_error_message: 'Could not reload the transaction after claiming resolution.',
    });
    return NextResponse.json({ error: 'Resolution requires manual reconciliation.' }, { status: 202 });
  }

  let providerReference: string | null = null;
  try {
    if (transaction.payment_provider === 'payluk') {
      if (!transaction.payluk_escrow_id) throw new Error('Missing Payluk escrow ID.');
      const status = refundAmount > 0 && sellerAmount > 0
        ? 'SPLIT'
        : refundAmount > 0
          ? 'REFUNDED'
          : 'COMPLETED';
      await PaylukService.resolveDispute(transaction.payluk_escrow_id, {
        resolution,
        status,
        sellerAmount: sellerAmount > 0 ? sellerAmount : undefined,
        buyerAmount: refundAmount > 0 ? refundAmount : undefined,
      });
    } else {
      if (refundAmount > 0) {
        const refunded = await PaystackService.refundTransaction(transaction.payment_reference, refundAmount);
        if (!refunded) throw new Error('Paystack did not confirm the refund.');
        providerReference = transaction.payment_reference;
      }
      if (sellerAmount > 0) {
        providerReference = await PayoutService.manualPayout(transaction.seller_id, sellerAmount, user.id);
      }
    }
  } catch (providerError) {
    const safeMessage = providerError instanceof Error ? providerError.message : 'Payment provider returned an unknown outcome.';
    await supabaseAdmin.rpc('flag_dispute_resolution_reconciliation', {
      p_operation_id: operation.id,
      p_error_message: safeMessage,
    });
    console.error('[ResolveDispute] Provider outcome requires reconciliation:', providerError);
    return NextResponse.json(
      { error: 'Payment outcome needs manual reconciliation. Do not retry this resolution.', resolutionStatus: 'needs_reconciliation' },
      { status: 202 },
    );
  }

  const { error: finishError } = await supabaseAdmin.rpc('finish_dispute_resolution', {
    p_operation_id: operation.id,
    p_provider_reference: providerReference,
  });
  if (finishError) {
    await supabaseAdmin.rpc('flag_dispute_resolution_reconciliation', {
      p_operation_id: operation.id,
      p_error_message: 'Provider accepted the resolution, but database finalization failed.',
    });
    console.error('[ResolveDispute] Provider succeeded, database finalization failed:', finishError);
    return NextResponse.json(
      { error: 'Payment was accepted; database finalization needs manual reconciliation.', resolutionStatus: 'needs_reconciliation' },
      { status: 202 },
    );
  }

  try {
    const [{ data: updatedDispute }, { data: updatedTransaction }] = await Promise.all([
      supabaseAdmin.from('disputes').select('resolved_at').eq('id', disputeId).single(),
      supabaseAdmin.from('escrow_transactions').select('buyer_id, seller_id, item_id, item_title, item_type').eq('id', transaction.id).single(),
    ]);
    if (updatedTransaction) {
      let itemTitle = updatedTransaction.item_title || 'Item';
      if (updatedTransaction.item_id) {
        const { data: post } = await supabaseAdmin.from('posts').select('title, text').eq('id', updatedTransaction.item_id).maybeSingle();
        const { data: catalog } = post ? { data: null } : await supabaseAdmin.from('catalog_items').select('title').eq('id', updatedTransaction.item_id).maybeSingle();
        itemTitle = post?.title || post?.text || catalog?.title || itemTitle;
      }
      await Promise.all([
        NotificationService.createDisputeResolvedNotification(updatedTransaction.buyer_id, itemTitle, resolution, disputeId, transaction.id),
        NotificationService.createDisputeResolvedNotification(updatedTransaction.seller_id, itemTitle, resolution, disputeId, transaction.id),
      ]);
    }
    void updatedDispute;
  } catch (notificationError) {
    console.error('[ResolveDispute] Resolution committed, notification failed:', notificationError);
  }

  return NextResponse.json({ success: true });
}
