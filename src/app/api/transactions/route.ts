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
      userIds.add(tx.buyer_id);
      userIds.add(tx.seller_id);
      itemIds.add(tx.item_id);
    });

    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, name, avatar_url')
      .in('id', Array.from(userIds));

    const { data: items } = await supabaseAdmin
      .from('posts')
      .select('id, title, text, image_urls, price')
      .in('id', Array.from(itemIds));

    // Create lookup maps
    const userMap = new Map(users?.map(u => [u.id, u]) || []);
    const itemMap = new Map(items?.map(i => [i.id, i]) || []);

    // Enrich transactions with related data
    const enrichedTransactions = transactions.map(tx => ({
      ...tx,
      buyer: userMap.get(tx.buyer_id) || { id: tx.buyer_id, name: 'Unknown' },
      seller: userMap.get(tx.seller_id) || { id: tx.seller_id, name: 'Unknown' },
      item: itemMap.get(tx.item_id) || { id: tx.item_id, title: 'Unknown', price: 0 },
    }));

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
