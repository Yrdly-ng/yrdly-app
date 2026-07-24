import { NextResponse, NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthenticatedUser } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, is_online, last_seen } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (!user || authError || user.id !== user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await supabaseAdmin
      .from('users')
      .update({
        is_online: is_online ?? false,
        last_seen: last_seen || new Date().toISOString(),
      })
      .eq('id', user_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('User status update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
