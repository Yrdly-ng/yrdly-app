import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { downloadDisputeEvidence, signDisputeEvidence } from '@/lib/dispute-evidence-server';
import { NotificationService } from '@/lib/server-notification-service';
import { PaylukService } from '@/lib/payluk-service';

const evidenceSchema = z.object({
  description: z.string().trim().min(20).max(4000),
  photos: z.array(z.string().min(1).max(1024)).max(5).default([]),
  chatScreenshots: z.array(z.string().min(1).max(1024)).max(5).optional(),
  additionalNotes: z.string().trim().max(2000).optional(),
});

const openSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
  evidence: evidenceSchema,
});

function createUserClient(accessToken: string) {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

async function enrichEvidence(evidence: unknown) {
  return signDisputeEvidence(evidence);
}

export async function GET(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'A session token is required' }, { status: 401 });

  const supabase = createUserClient(token);
  const { data, error: queryError } = await supabase
    .from('disputes')
    .select(`id, transaction_id, opened_by, dispute_reason, buyer_evidence, seller_evidence, resolution, status, resolved_by, refund_amount, seller_amount, created_at, updated_at, resolved_at, transaction:escrow_transactions!inner(id, amount, buyer_id, seller_id, status, item_id, item_title, item_type)`)
    .order('created_at', { ascending: false });

  if (queryError) {
    console.error('[DisputesAPI] User list query failed:', queryError);
    return NextResponse.json({ error: 'Failed to load disputes' }, { status: 500 });
  }

  const rows = (data || []).map((row) => ({
    ...row,
    transaction: Array.isArray(row.transaction) ? row.transaction[0] : row.transaction,
  }));
  const itemIds = Array.from(new Set(rows.map((row) => row.transaction?.item_id).filter(Boolean)));
  const [{ data: posts }, { data: catalogItems }] = await Promise.all([
    itemIds.length ? supabaseAdmin.from('posts').select('id, title, text, image_urls, image_url, price').in('id', itemIds) : Promise.resolve({ data: [] }),
    itemIds.length ? supabaseAdmin.from('catalog_items').select('id, title, description, images, price').in('id', itemIds) : Promise.resolve({ data: [] }),
  ]);
  const itemById = new Map<string, any>();
  for (const item of posts || []) {
    const images = Array.isArray(item.image_urls) ? item.image_urls : item.image_url ? [item.image_url] : [];
    itemById.set(item.id, { id: item.id, title: item.title || item.text || 'Item', image_urls: images, images, price: item.price });
  }
  for (const item of catalogItems || []) {
    const images = Array.isArray(item.images) ? item.images : typeof item.images === 'string' ? [item.images] : [];
    itemById.set(item.id, { id: item.id, title: item.title || 'Item', description: item.description, image_urls: images, images, price: item.price });
  }

  const disputes = await Promise.all(rows.map(async (row: any) => ({
    id: row.id,
    transactionId: row.transaction_id,
    openedBy: row.opened_by,
    disputeReason: row.dispute_reason,
    buyerEvidence: await enrichEvidence(row.buyer_evidence || {}),
    sellerEvidence: await enrichEvidence(row.seller_evidence || {}),
    resolution: row.resolution,
    status: row.status,
    refundAmount: Number(row.refund_amount || 0),
    sellerAmount: Number(row.seller_amount || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    transaction: {
      ...row.transaction,
      item: itemById.get(row.transaction?.item_id) || {
        id: row.transaction?.item_id,
        title: row.transaction?.item_title || 'Item',
        image_urls: [],
      },
    },
  })));

  return NextResponse.json({ data: disputes });
}

export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = openSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Provide a reason and valid evidence (up to five files).' }, { status: 400 });
  }
  const { transactionId, reason, evidence } = parsed.data;

  for (const path of [...evidence.photos, ...(evidence.chatScreenshots || [])]) {
    if (!path.startsWith(`${transactionId}/${user.id}/`)) {
      return NextResponse.json({ error: 'Evidence files must belong to this transaction and your account.' }, { status: 400 });
    }
    const { error: fileError } = await supabaseAdmin.storage.from('dispute-evidence').createSignedUrl(path, 30);
    if (fileError) return NextResponse.json({ error: 'One or more evidence files could not be verified.' }, { status: 400 });
  }

  const { data: targetTransaction } = await supabaseAdmin
    .from('escrow_transactions')
    .select('buyer_id, payment_provider, payluk_tx_ref')
    .eq('id', transactionId)
    .maybeSingle();
  if (targetTransaction?.payment_provider === 'payluk' && evidence.photos.length + (evidence.chatScreenshots?.length || 0) > 1) {
    return NextResponse.json({ error: 'Payluk accepts one evidence attachment per dispute filing. Select one file.' }, { status: 400 });
  }

  const { data: disputeId, error: openError } = await supabaseAdmin.rpc('open_marketplace_dispute', {
    p_transaction_id: transactionId,
    p_opened_by: user.id,
    p_reason: reason,
    p_evidence: evidence,
  });
  if (openError || !disputeId) {
    console.error('[DisputesAPI] Could not open dispute:', openError);
    const isConflict = openError?.code === '23505';
    return NextResponse.json(
      { error: isConflict ? 'A dispute already exists for this transaction.' : openError?.message || 'Could not open dispute.' },
      { status: isConflict ? 409 : 400 },
    );
  }

  let providerSubmissionStatus: 'not_required' | 'submitted' | 'needs_reconciliation' = 'not_required';
  const openedTransaction = targetTransaction;
  if (openedTransaction?.payment_provider === 'payluk') {
    providerSubmissionStatus = 'needs_reconciliation';
    const message = `${reason}: ${evidence.description}`.slice(0, 4000);
    await supabaseAdmin.from('disputes').update({
      provider_submission_status: 'processing',
      provider_submission_error: null,
    }).eq('id', disputeId);

    try {
      const { data: buyer } = await supabaseAdmin
        .from('users')
        .select('payluk_customer_id')
        .eq('id', openedTransaction.buyer_id)
        .maybeSingle();
      if (!buyer?.payluk_customer_id || !openedTransaction.payluk_tx_ref) {
        throw new Error('Missing buyer Payluk account or escrow payment token.');
      }
      const evidencePath = evidence.photos[0] || evidence.chatScreenshots?.[0];
      const attachment = evidencePath ? await downloadDisputeEvidence(evidencePath) : undefined;
      if (evidencePath && !attachment) throw new Error('Could not load the saved evidence attachment for Payluk.');
      await PaylukService.submitDispute(buyer.payluk_customer_id, openedTransaction.payluk_tx_ref, message, attachment || undefined);
      const { error: persistError } = await supabaseAdmin.from('disputes').update({
        provider_submission_status: 'submitted',
        provider_submission_error: null,
      }).eq('id', disputeId);
      if (persistError) throw new Error('Payluk accepted the dispute but the local submission status could not be saved.');
      providerSubmissionStatus = 'submitted';
    } catch (providerError) {
      const providerMessage = providerError instanceof Error ? providerError.message : 'Unknown Payluk submission outcome.';
      console.error('[DisputesAPI] Payluk dispute submission needs reconciliation:', providerError);
      await supabaseAdmin.from('disputes').update({
        provider_submission_status: 'needs_reconciliation',
        provider_submission_error: providerMessage.slice(0, 1000),
      }).eq('id', disputeId);
    }
  }

  try {
    const [{ data: transaction }, { data: opener }] = await Promise.all([
      supabaseAdmin.from('escrow_transactions').select('buyer_id, seller_id, item_id, item_title').eq('id', transactionId).maybeSingle(),
      supabaseAdmin.from('users').select('name').eq('id', user.id).maybeSingle(),
    ]);
    if (transaction) {
      const otherUserId = user.id === transaction.buyer_id ? transaction.seller_id : transaction.buyer_id;
      let itemTitle = transaction.item_title || 'Item';
      if (transaction.item_id) {
        const { data: post } = await supabaseAdmin.from('posts').select('title, text').eq('id', transaction.item_id).maybeSingle();
        const { data: catalog } = post ? { data: null } : await supabaseAdmin.from('catalog_items').select('title').eq('id', transaction.item_id).maybeSingle();
        itemTitle = post?.title || post?.text || catalog?.title || itemTitle;
      }
      await NotificationService.createDisputeOpenedNotification(otherUserId, opener?.name || 'A participant', itemTitle, disputeId, transactionId);
    }
  } catch (notificationError) {
    console.error('[DisputesAPI] Dispute opened, notification failed:', notificationError);
  }

  return NextResponse.json({ id: disputeId, providerSubmissionStatus }, { status: 201 });
}
