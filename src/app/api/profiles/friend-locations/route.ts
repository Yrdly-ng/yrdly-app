import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: outgoing, error: outError } = await supabaseAdmin.from('followers').select('following_id').eq('follower_id', user.id);
  const { data: incoming, error: inError } = await supabaseAdmin.from('followers').select('follower_id').eq('following_id', user.id);
  if (outError || inError) return NextResponse.json({ error: 'Could not load friends' }, { status: 500 });
  const incomingIds = new Set(incoming?.map(row => row.follower_id));
  const ids = outgoing?.map(row => row.following_id).filter(id => incomingIds.has(id)) || [];
  if (!ids.length) return NextResponse.json({ data: [] });
  const { data, error: readError } = await supabaseAdmin.from('users').select('id,name,avatar_url,current_location')
    .in('id', ids).eq('share_location', true).not('current_location', 'is', null);
  if (readError) return NextResponse.json({ error: 'Could not load shared locations' }, { status: 500 });
  return NextResponse.json({ data });
}
