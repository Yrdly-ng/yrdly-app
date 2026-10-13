import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PaylukService } from '@/lib/payluk-service';
import { downloadDisputeEvidence } from '@/lib/dispute-evidence-server';

const updateSchema = z.object({
  notes: z.string().trim().max(5000).optional(),
  status: z.enum(['under_review']).optional(),
  providerSubmissionStatus: z.enum(['submitted', 'retry']).optional(),
  providerSellerReplyStatus: z.enum(['submitted', 'retry']).optional(),
}).refine((value) => value.notes !== undefined || value.status !== undefined || value.providerSubmissionStatus !== undefined || value.providerSellerReplyStatus !== undefined);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ disputeId: string }> },
) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });

  const { data: profile } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Provide valid admin notes or move the dispute under review.' }, { status: 400 });
  const { disputeId } = await context.params;
  if (parsed.data.providerSellerReplyStatus === 'retry') {
    const { data: dispute } = await supabaseAdmin.from('disputes').select('id, transaction_id, seller_evidence, provider_seller_reply_status')
      .eq('id', disputeId).maybeSingle();
    if (!dispute || dispute.provider_seller_reply_status !== 'needs_reconciliation') {
      return NextResponse.json({ error: 'Only an uncertain Payluk seller reply can be retried.' }, { status: 409 });
    }
    const { data: transaction } = await supabaseAdmin.from('escrow_transactions').select('seller_id, payment_provider, payluk_tx_ref')
      .eq('id', dispute.transaction_id).maybeSingle();
    if (!transaction || transaction.payment_provider !== 'payluk' || !transaction.payluk_tx_ref) {
      return NextResponse.json({ error: 'Payluk seller or payment token is unavailable.' }, { status: 409 });
    }
    const { data: claimed } = await supabaseAdmin.from('disputes')
      .update({ provider_seller_reply_status: 'processing', provider_seller_reply_error: null, updated_at: new Date().toISOString() })
      .eq('id', disputeId).eq('provider_seller_reply_status', 'needs_reconciliation').select('id').maybeSingle();
    if (!claimed) return NextResponse.json({ error: 'Another administrator is reconciling the seller reply.' }, { status: 409 });
    try {
      const { data: seller } = await supabaseAdmin.from('users').select('payluk_customer_id').eq('id', transaction.seller_id).maybeSingle();
      if (!seller?.payluk_customer_id) throw new Error('Seller Payluk account is unavailable.');
      const evidence = dispute.seller_evidence || {};
      const evidencePath = evidence.photos?.[0] || evidence.chatScreenshots?.[0];
      const attachment = evidencePath ? await downloadDisputeEvidence(evidencePath) : undefined;
      if (evidencePath && !attachment) throw new Error('Could not load the saved seller evidence attachment for Payluk.');
      const message = [evidence.description, evidence.additionalNotes].filter(Boolean).join('\n\n').slice(0, 4000)
        || 'Seller submitted additional evidence through YRDLY.';
      await PaylukService.submitDispute(seller.payluk_customer_id, transaction.payluk_tx_ref, message, attachment || undefined);
      const { error: saveError } = await supabaseAdmin.from('disputes').update({ provider_seller_reply_status: 'submitted', provider_seller_reply_error: null, updated_at: new Date().toISOString() })
        .eq('id', disputeId).eq('provider_seller_reply_status', 'processing');
      if (saveError) throw new Error('Payluk accepted the seller reply but its status could not be saved.');
      return NextResponse.json({ success: true, providerSellerReplyStatus: 'submitted' });
    } catch (providerError) {
      const message = providerError instanceof Error ? providerError.message : 'Unknown Payluk response.';
      await supabaseAdmin.from('disputes').update({ provider_seller_reply_status: 'needs_reconciliation', provider_seller_reply_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq('id', disputeId).eq('provider_seller_reply_status', 'processing');
      return NextResponse.json({ error: 'Payluk seller reply still needs reconciliation.', providerSellerReplyStatus: 'needs_reconciliation' }, { status: 202 });
    }
  }
  if (parsed.data.providerSellerReplyStatus === 'submitted') {
    const { data, error } = await supabaseAdmin.from('disputes').update({
      provider_seller_reply_status: 'submitted', provider_seller_reply_error: null, updated_at: new Date().toISOString(),
    }).eq('id', disputeId).in('provider_seller_reply_status', ['processing', 'needs_reconciliation']).select('id').maybeSingle();
    if (error || !data) return NextResponse.json({ error: 'Could not confirm Payluk seller reply status.' }, { status: error ? 500 : 409 });
    return NextResponse.json({ success: true, providerSellerReplyStatus: 'submitted' });
  }
  if (parsed.data.providerSubmissionStatus === 'retry') {
    const { data: dispute } = await supabaseAdmin.from('disputes')
      .select('id, transaction_id, opened_by, dispute_reason, buyer_evidence, seller_evidence, provider_submission_status')
      .eq('id', disputeId).maybeSingle();
    if (!dispute || dispute.provider_submission_status !== 'needs_reconciliation') {
      return NextResponse.json({ error: 'Only a provider submission needing reconciliation can be retried.' }, { status: 409 });
    }
    const { data: transaction } = await supabaseAdmin.from('escrow_transactions')
      .select('buyer_id, payment_provider, payluk_tx_ref')
      .eq('id', dispute.transaction_id).maybeSingle();
    if (!transaction || transaction.payment_provider !== 'payluk' || dispute.opened_by !== transaction.buyer_id || !transaction.payluk_tx_ref) {
      return NextResponse.json({ error: 'Payluk buyer or payment token is unavailable.' }, { status: 409 });
    }
    const { data: claimed } = await supabaseAdmin.from('disputes')
      .update({ provider_submission_status: 'processing', provider_submission_error: null, updated_at: new Date().toISOString() })
      .eq('id', disputeId).eq('provider_submission_status', 'needs_reconciliation')
      .select('id').maybeSingle();
    if (!claimed) return NextResponse.json({ error: 'Another administrator is already reconciling this submission.' }, { status: 409 });
    try {
      const { data: buyer } = await supabaseAdmin.from('users').select('payluk_customer_id').eq('id', transaction.buyer_id).maybeSingle();
      if (!buyer?.payluk_customer_id) throw new Error('Buyer Payluk account is unavailable.');
      const evidence = dispute.buyer_evidence || dispute.seller_evidence || {};
      const message = `${dispute.dispute_reason}: ${evidence.description || ''}`.slice(0, 4000);
      await PaylukService.submitDispute(buyer.payluk_customer_id, transaction.payluk_tx_ref, message);
      const { error: saveError } = await supabaseAdmin.from('disputes')
        .update({ provider_submission_status: 'submitted', provider_submission_error: null, updated_at: new Date().toISOString() })
        .eq('id', disputeId);
      if (saveError) throw new Error('Payluk accepted the dispute but local status could not be saved.');
      return NextResponse.json({ success: true, providerSubmissionStatus: 'submitted' });
    } catch (providerError) {
      const message = providerError instanceof Error ? providerError.message : 'Unknown Payluk response.';
      await supabaseAdmin.from('disputes').update({
        provider_submission_status: 'needs_reconciliation',
        provider_submission_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq('id', disputeId);
      return NextResponse.json({ error: 'Payluk submission still needs reconciliation.', providerSubmissionStatus: 'needs_reconciliation' }, { status: 202 });
    }
  }
  const update: { admin_notes?: string | null; status?: 'under_review'; provider_submission_status?: 'submitted'; provider_submission_error?: null; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.notes !== undefined) update.admin_notes = parsed.data.notes || null;
  if (parsed.data.status) update.status = parsed.data.status;
  if (parsed.data.providerSubmissionStatus) {
    update.provider_submission_status = 'submitted';
    update.provider_submission_error = null;
  }
  let query = supabaseAdmin
    .from('disputes')
    .update(update)
    .eq('id', disputeId);
  if (parsed.data.providerSubmissionStatus) {
    query = query.in('provider_submission_status', ['processing', 'needs_reconciliation']);
  }
  const { data, error } = await query.select('id').maybeSingle();
  if (error || !data) {
    console.error('[AdminDisputeAPI] Note update failed:', error);
    return NextResponse.json({ error: 'Could not save admin notes.' }, { status: error ? 500 : 404 });
  }
  return NextResponse.json({ success: true });
}
