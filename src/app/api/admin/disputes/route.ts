import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { signDisputeEvidence } from '@/lib/dispute-evidence-server';

export async function GET(request: NextRequest) {
  try {
    // 1. Verify Authentication & Admin Privileges
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_admin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // 2. Parse Query Parameters
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') || 'all';
    const page = Math.max(1, Math.min(10000, Number.parseInt(searchParams.get('page') || '1', 10) || 1));
    const limit = Math.max(1, Math.min(100, Number.parseInt(searchParams.get('limit') || '20', 10) || 20));

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // 3. Query All Disputes via Admin Client
    let query = supabaseAdmin
      .from('disputes')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: disputes, error, count } = await query;

    if (error) {
      console.error('[AdminDisputesAPI] Error fetching disputes:', error);
      return NextResponse.json({ error: 'Failed to fetch disputes' }, { status: 500 });
    }

    if (!disputes || disputes.length === 0) {
      return NextResponse.json({ data: [], count: 0 });
    }

    // 4. Collect transaction IDs
    const txIds = Array.from(new Set(disputes.map(d => d.transaction_id).filter(Boolean)));
    const { data: transactions } = await supabaseAdmin
      .from('escrow_transactions')
      .select('*')
      .in('id', txIds);

    const txMap = new Map(transactions?.map(t => [t.id, t]) || []);

    // 5. Collect user & item IDs
    const userIds = new Set<string>();
    const itemIds = new Set<string>();

    transactions?.forEach(t => {
      if (t.buyer_id) userIds.add(t.buyer_id);
      if (t.seller_id) userIds.add(t.seller_id);
      if (t.item_id) itemIds.add(t.item_id);
    });

    const [
      { data: users },
      { data: postsItems },
      { data: catalogItems }
    ] = await Promise.all([
      userIds.size > 0
        ? supabaseAdmin.from('users').select('id, name, avatar_url, email').in('id', Array.from(userIds))
        : Promise.resolve({ data: [] }),
      itemIds.size > 0
        ? supabaseAdmin.from('posts').select('id, title, text, image_urls, image_url, price').in('id', Array.from(itemIds))
        : Promise.resolve({ data: [] }),
      itemIds.size > 0
        ? supabaseAdmin.from('catalog_items').select('id, title, description, images, price').in('id', Array.from(itemIds))
        : Promise.resolve({ data: [] }),
    ]);

    const userMap = new Map(users?.map(u => [u.id, u]) || []);
    const itemMap = new Map<string, any>();

    postsItems?.forEach(p => {
      const imgs = Array.isArray(p.image_urls) ? p.image_urls : p.image_url ? [p.image_url] : [];
      itemMap.set(p.id, { id: p.id, title: p.title || p.text || 'Item', image_urls: imgs, images: imgs, price: p.price });
    });

    catalogItems?.forEach(c => {
      const imgs = Array.isArray(c.images) ? c.images : typeof c.images === 'string' ? [c.images] : [];
      itemMap.set(c.id, { id: c.id, title: c.title || 'Item', image_urls: imgs, images: imgs, price: c.price });
    });

    // 6. Enrich disputes
    const enrichedDisputes = await Promise.all(disputes.map(async d => {
      const tx = txMap.get(d.transaction_id);
      const buyer = tx ? userMap.get(tx.buyer_id) : null;
      const seller = tx ? userMap.get(tx.seller_id) : null;
      const item = tx ? (itemMap.get(tx.item_id) || { id: tx.item_id, title: tx.item_title || tx.purpose || 'Item', price: tx.amount || 0 }) : null;

      return {
        ...d,
        transactionId: d.transaction_id,
        openedBy: d.opened_by,
        disputeReason: d.dispute_reason || 'Other',
        buyerEvidence: await signDisputeEvidence(d.buyer_evidence || {}),
        sellerEvidence: await signDisputeEvidence(d.seller_evidence || {}),
        adminNotes: d.admin_notes || '',
        refundAmount: d.refund_amount || 0,
        sellerAmount: d.seller_amount || 0,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        resolvedAt: d.resolved_at,
        transaction: tx ? {
          ...tx,
          buyer: buyer || { id: tx.buyer_id, name: 'Buyer' },
          seller: seller || { id: tx.seller_id, name: 'Seller' },
          item,
        } : null
      };
    }));

    return NextResponse.json({ data: enrichedDisputes, count: count || 0 });
  } catch (error: any) {
    console.error('[AdminDisputesAPI] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
