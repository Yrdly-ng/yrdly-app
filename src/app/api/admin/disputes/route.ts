import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

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
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // 3. Query All Disputes via Admin Client (Bypassing user-scoped RLS)
    let query = supabaseAdmin
      .from('disputes')
      .select(`
        *,
        transaction:escrow_transactions(
          id,
          amount,
          buyer_id,
          seller_id,
          status,
          item:posts(
            id,
            title,
            text,
            image_urls
          ),
          buyer:users!buyer_id(
            id,
            name,
            avatar_url
          ),
          seller:users!seller_id(
            id,
            name,
            avatar_url
          )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[AdminDisputesAPI] Error fetching disputes:', error);
      return NextResponse.json({ error: 'Failed to fetch disputes' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [], count: count || 0 });
  } catch (error: any) {
    console.error('[AdminDisputesAPI] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
