import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> }
) {
  try {
    const { disputeId: idOrTxId } = await params;

    // 1. Authenticate user
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch dispute record (check both id and transaction_id)
    const { data: dispute, error: disputeError } = await supabaseAdmin
      .from('disputes')
      .select('*')
      .or(`id.eq.${idOrTxId},transaction_id.eq.${idOrTxId}`)
      .maybeSingle();

    if (disputeError || !dispute) {
      console.warn(`[DisputeAPI] Dispute not found for query: ${idOrTxId}`, disputeError);
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    // 3. Fetch transaction
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('*')
      .eq('id', dispute.transaction_id)
      .single();

    if (txError || !transaction) {
      return NextResponse.json({ error: 'Associated transaction not found' }, { status: 404 });
    }

    // 4. Check user authorization (must be buyer, seller, or admin)
    const isBuyer = user.id === transaction.buyer_id;
    const isSeller = user.id === transaction.seller_id;
    const isOpener = user.id === dispute.opened_by;

    let isAdmin = false;
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (profile?.is_admin) {
      isAdmin = true;
    }

    if (!isBuyer && !isSeller && !isOpener && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden: You do not have permission to view this dispute' }, { status: 403 });
    }

    // 5. Fetch buyer & seller user profiles
    const [ { data: buyer }, { data: seller } ] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('id, name, avatar_url, email')
        .eq('id', transaction.buyer_id)
        .single(),
      supabaseAdmin
        .from('users')
        .select('id, name, avatar_url, email')
        .eq('id', transaction.seller_id)
        .single(),
    ]);

    // 6. Fetch related item details (check catalog_items first, then posts)
    let itemData: any = null;
    if (transaction.item_id) {
      const { data: catItem } = await supabaseAdmin
        .from('catalog_items')
        .select('id, title, description, images, price')
        .eq('id', transaction.item_id)
        .maybeSingle();

      if (catItem) {
        const imgs = Array.isArray(catItem.images)
          ? catItem.images
          : typeof catItem.images === 'string'
          ? [catItem.images]
          : [];
        itemData = {
          id: catItem.id,
          title: catItem.title || 'Item',
          description: catItem.description,
          image_urls: imgs,
          images: imgs,
          price: catItem.price,
        };
      } else {
        const { data: postItem } = await supabaseAdmin
          .from('posts')
          .select('id, title, text, description, image_urls, image_url, price')
          .eq('id', transaction.item_id)
          .maybeSingle();

        if (postItem) {
          const imgs = Array.isArray(postItem.image_urls)
            ? postItem.image_urls
            : postItem.image_url
            ? [postItem.image_url]
            : [];
          itemData = {
            id: postItem.id,
            title: postItem.title || postItem.text || 'Item',
            description: postItem.description,
            image_urls: imgs,
            images: imgs,
            price: postItem.price,
          };
        }
      }
    }

    if (!itemData) {
      itemData = {
        id: transaction.item_id,
        title: transaction.item_title || transaction.purpose || 'Transaction Item',
        price: transaction.amount || 0,
        images: [],
        image_urls: [],
      };
    }

    // 7. Format output
    const enrichedDispute = {
      id: dispute.id,
      transactionId: dispute.transaction_id,
      openedBy: dispute.opened_by,
      disputeReason: dispute.dispute_reason,
      buyerEvidence: dispute.buyer_evidence || {},
      sellerEvidence: dispute.seller_evidence || {},
      adminNotes: dispute.admin_notes,
      resolution: dispute.resolution,
      status: dispute.status,
      resolvedBy: dispute.resolved_by,
      refundAmount: dispute.refund_amount || 0,
      sellerAmount: dispute.seller_amount || 0,
      createdAt: dispute.created_at,
      updatedAt: dispute.updated_at,
      resolvedAt: dispute.resolved_at,
      transaction: {
        id: transaction.id,
        amount: transaction.amount,
        buyer_id: transaction.buyer_id,
        seller_id: transaction.seller_id,
        status: transaction.status,
        item: itemData,
        buyer: buyer || { id: transaction.buyer_id, name: 'Buyer', email: '' },
        seller: seller || { id: transaction.seller_id, name: 'Seller', email: '' },
      }
    };

    return NextResponse.json(enrichedDispute);
  } catch (error: any) {
    console.error('[DisputeAPI] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
