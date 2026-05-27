import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { user_id, is_online, last_seen } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
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
