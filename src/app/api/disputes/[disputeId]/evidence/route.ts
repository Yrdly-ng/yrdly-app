import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { downloadDisputeEvidence } from '@/lib/dispute-evidence-server';
import { PaylukService } from '@/lib/payluk-service';

const evidenceSchema = z.object({
  description: z.string().trim().max(4000).optional(),
  photos: z.array(z.string().min(1).max(1024)).max(5).optional(),
  chatScreenshots: z.array(z.string().min(1).max(1024)).max(5).optional(),
  additionalNotes: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ disputeId: string }> },
) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { disputeId } = await context.params;
  const parsed = evidenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid evidence.' }, { status: 400 });

  const { data: dispute } = await supabaseAdmin
    .from('disputes')
    .select('id, transaction_id, status, provider_seller_reply_status')
    .eq('id', disputeId)
    .maybeSingle();
  if (!dispute) return NextResponse.json({ error: 'Dispute not found.' }, { status: 404 });

  const { data: transaction } = await supabaseAdmin
    .from('escrow_transactions')
    .select('buyer_id, seller_id, payment_provider, payluk_tx_ref')
    .eq('id', dispute.transaction_id)
    .maybeSingle();
  if (!transaction || (user.id !== transaction.buyer_id && user.id !== transaction.seller_id)) {
    return NextResponse.json({ error: 'You are not a party to this dispute.' }, { status: 403 });
  }
  if (!['open', 'under_review'].includes(dispute.status)) {
    return NextResponse.json({ error: 'Evidence can only be added to an open dispute.' }, { status: 409 });
  }

  const { photos = [], chatScreenshots = [], ...details } = parsed.data;
  const isPaylukSellerReply = transaction.payment_provider === 'payluk' && user.id === transaction.seller_id;
  if (isPaylukSellerReply && photos.length + chatScreenshots.length > 1) {
    return NextResponse.json({ error: 'Payluk accepts one evidence attachment per seller reply. Select one file.' }, { status: 400 });
  }
  if (isPaylukSellerReply && dispute.provider_seller_reply_status !== 'not_required') {
    return NextResponse.json({ error: 'A Payluk seller reply has already been submitted or needs reconciliation.' }, { status: 409 });
  }
  for (const path of [...photos, ...chatScreenshots]) {
    if (!path.startsWith(`${dispute.transaction_id}/${user.id}/`)) {
      return NextResponse.json({ error: 'Evidence files must belong to this transaction and your account.' }, { status: 400 });
    }
    const { error } = await supabaseAdmin.storage.from('dispute-evidence').createSignedUrl(path, 30);
    if (error) return NextResponse.json({ error: 'One or more evidence files could not be verified.' }, { status: 400 });
  }

  if (isPaylukSellerReply) {
    const { data: claimed } = await supabaseAdmin.from('disputes')
      .update({ provider_seller_reply_status: 'processing', provider_seller_reply_error: null, updated_at: new Date().toISOString() })
      .eq('id', disputeId).eq('provider_seller_reply_status', 'not_required')
      .select('id').maybeSingle();
    if (!claimed) return NextResponse.json({ error: 'Another seller reply is already being submitted.' }, { status: 409 });
  }

  const { error: updateError } = await supabaseAdmin.rpc('append_dispute_evidence', {
    p_dispute_id: disputeId,
    p_user_id: user.id,
    p_evidence: { ...details, photos, chatScreenshots },
  });
  if (updateError) {
    if (isPaylukSellerReply) {
      await supabaseAdmin.from('disputes').update({
        provider_seller_reply_status: 'not_required',
        provider_seller_reply_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', disputeId).eq('provider_seller_reply_status', 'processing');
    }
    console.error('[DisputeEvidenceAPI] Evidence update failed:', updateError);
    return NextResponse.json({ error: 'Could not save evidence.' }, { status: 500 });
  }

  if (isPaylukSellerReply) {
    try {
      if (!transaction.payluk_tx_ref) throw new Error('Payluk payment token is unavailable.');
      const [{ data: seller }, attachment] = await Promise.all([
        supabaseAdmin.from('users').select('payluk_customer_id').eq('id', transaction.seller_id).maybeSingle(),
        photos[0] || chatScreenshots[0] ? downloadDisputeEvidence(photos[0] || chatScreenshots[0]) : Promise.resolve(null),
      ]);
      if (!seller?.payluk_customer_id) throw new Error('Seller Payluk account is unavailable.');
      if ((photos.length || chatScreenshots.length) && !attachment) throw new Error('Could not load the saved evidence attachment for Payluk.');
      const message = [details.description, details.additionalNotes].filter(Boolean).join('\n\n').slice(0, 4000)
        || 'Seller submitted additional evidence through YRDLY.';
      await PaylukService.submitDispute(seller.payluk_customer_id, transaction.payluk_tx_ref, message, attachment || undefined);
      const { error: saveError } = await supabaseAdmin.from('disputes').update({
        provider_seller_reply_status: 'submitted',
        provider_seller_reply_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', disputeId).eq('provider_seller_reply_status', 'processing');
      if (saveError) throw new Error('Payluk accepted the seller reply but its status could not be saved.');
      return NextResponse.json({ success: true, providerSellerReplyStatus: 'submitted' });
    } catch (providerError) {
      const message = providerError instanceof Error ? providerError.message : 'Unknown Payluk response.';
      await supabaseAdmin.from('disputes').update({
        provider_seller_reply_status: 'needs_reconciliation',
        provider_seller_reply_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq('id', disputeId).eq('provider_seller_reply_status', 'processing');
      console.error('[DisputeEvidenceAPI] Payluk seller reply needs reconciliation:', providerError);
      return NextResponse.json({ success: true, providerSellerReplyStatus: 'needs_reconciliation' }, { status: 202 });
    }
  }

  return NextResponse.json({ success: true });
}
