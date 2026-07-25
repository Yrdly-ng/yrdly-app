import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from "@supabase/supabase-js";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: transactionId } = await params;

    // Get authenticated user
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Fetch transaction with admin client to bypass RLS
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) {
      console.error(`[TransactionAPI] Transaction not found: ${transactionId}`, txError);
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    // Verify user is either buyer or seller
    if (user.id !== transaction.buyer_id && user.id !== transaction.seller_id) {
      console.warn(`[TransactionAPI] User ${user.id} unauthorized to view transaction ${transactionId}`);
      return NextResponse.json(
        { error: 'Unauthorized to view this transaction' },
        { status: 403 }
      );
    }

    // Fetch related user data
    const { data: buyer } = await supabaseAdmin
      .from('users')
      .select('id, name, avatar_url, email')
      .eq('id', transaction.buyer_id)
      .single();

    const { data: seller } = await supabaseAdmin
      .from('users')
      .select('id, name, avatar_url, email')
      .eq('id', transaction.seller_id)
      .single();

    // Fetch related item data
    const { data: item } = await supabaseAdmin
      .from('posts')
      .select('id, title, text, description, image_urls, price')
      .eq('id', transaction.item_id)
      .single();

    console.log(`[TransactionAPI] Successfully fetched transaction ${transactionId} for user ${user.id}`);

    return NextResponse.json({
      ...transaction,
      buyer: buyer || { id: transaction.buyer_id, name: 'Unknown', email: '' },
      seller: seller || { id: transaction.seller_id, name: 'Unknown', email: '' },
      item: item || { id: transaction.item_id, title: 'Unknown', price: 0 },
    });
  } catch (error) {
    console.error('[TransactionAPI] Error fetching transaction:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transaction details' },
      { status: 500 }
    );
  }
}
