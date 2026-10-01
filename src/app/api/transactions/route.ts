import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthenticatedUser } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    // Get authenticated user
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get limit from query params
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);

    // Fetch transactions where user is buyer or seller
    const { data: transactions, error: txError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('*')
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (txError) {
      console.error('[TransactionsAPI] Error fetching transactions:', txError);
      return NextResponse.json(
        { error: 'Failed to fetch transactions' },
        { status: 500 }
      );
    }

    if (!transactions || transactions.length === 0) {
      return NextResponse.json([]);
    }

    // Fetch all related users and items in bulk
    const userIds = new Set<string>();
    const itemIds = new Set<string>();

    transactions.forEach(tx => {
      if (tx.buyer_id) userIds.add(tx.buyer_id);
      if (tx.seller_id) userIds.add(tx.seller_id);
      if (tx.item_id) itemIds.add(tx.item_id);
    });

    const [
      { data: users },
      { data: postsItems },
      { data: catalogItems }
    ] = await Promise.all([
      userIds.size > 0
        ? supabaseAdmin.from('users').select('id, name, avatar_url').in('id', Array.from(userIds))
        : Promise.resolve({ data: [] }),
      itemIds.size > 0
        ? supabaseAdmin.from('posts').select('id, title, text, image_urls, image_url, price').in('id', Array.from(itemIds))
        : Promise.resolve({ data: [] }),
      itemIds.size > 0
        ? supabaseAdmin.from('catalog_items').select('id, title, description, images, price').in('id', Array.from(itemIds))
        : Promise.resolve({ data: [] }),
    ]);

    // Create lookup maps
    const userMap = new Map(users?.map(u => [u.id, u]) || []);
    const itemMap = new Map<string, any>();

    postsItems?.forEach(p => {
      const imgs = Array.isArray(p.image_urls)
        ? p.image_urls
        : typeof p.image_urls === 'string'
        ? [p.image_urls]
        : p.image_url
        ? [p.image_url]
        : [];
      itemMap.set(p.id, {
        id: p.id,
        title: p.title || p.text || 'Item',
        image_urls: imgs,
        images: imgs,
        price: p.price,
      });
    });

    catalogItems?.forEach(c => {
      const imgs = Array.isArray(c.images)
        ? c.images
        : typeof c.images === 'string'
        ? [c.images]
        : [];
      itemMap.set(c.id, {
        id: c.id,
        title: c.title || 'Item',
        image_urls: imgs,
        images: imgs,
        price: c.price,
      });
    });

    // Enrich transactions with related data and camelCase properties
    const enrichedTransactions = transactions.map(tx => {
      let deliveryDetails = tx.delivery_details;
      if (typeof deliveryDetails === 'string') {
        try {
          deliveryDetails = JSON.parse(deliveryDetails);
        } catch {
          deliveryDetails = { option: 'face_to_face' };
        }
      }
      if (!deliveryDetails || typeof deliveryDetails !== 'object') {
        deliveryDetails = { option: 'face_to_face' };
      }
      if (!deliveryDetails.option) {
        deliveryDetails.option = 'face_to_face';
      }

      const item = itemMap.get(tx.item_id) || {
        id: tx.item_id,
        title: tx.item_title || tx.purpose || 'Transaction Item',
        price: tx.amount || 0,
        images: [],
        image_urls: [],
      };

      return {
        ...tx,
        itemId: tx.item_id,
        buyerId: tx.buyer_id,
        sellerId: tx.seller_id,
        totalAmount: tx.amount,
        sellerAmount: tx.seller_amount ?? Math.round(tx.amount * 0.97),
        commission: tx.commission ?? Math.round(tx.amount * 0.03),
        paymentMethod: tx.payment_method || 'card',
        deliveryDetails,
        createdAt: tx.created_at,
        updatedAt: tx.updated_at,
        paidAt: tx.paid_at,
        shippedAt: tx.shipped_at,
        deliveredAt: tx.delivered_at,
        completedAt: tx.completed_at,
        disputeReason: tx.dispute_reason,
        buyer: userMap.get(tx.buyer_id) || { id: tx.buyer_id, name: 'Unknown' },
        seller: userMap.get(tx.seller_id) || { id: tx.seller_id, name: 'Unknown' },
        item,
      };
    });

    console.log(`[TransactionsAPI] Successfully fetched ${enrichedTransactions.length} transactions for user ${user.id}`);

    return NextResponse.json(enrichedTransactions);
  } catch (error) {
    console.error('[TransactionsAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}
