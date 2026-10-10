import { NextRequest,NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { invokeServerFunction } from '@/lib/server-functions';
export async function POST(request:NextRequest) {
  const { data:{ user },error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error:'Invalid session' },{ status:error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401 });
  const { data:allowed,error:limitError } = await supabaseAdmin.rpc('consume_rate_limit',{ p_user_id:user.id,p_endpoint:'/api/notifications/test',p_max_requests:3,p_window_seconds:60 });
  if (limitError) return NextResponse.json({ error:'Try again later' },{ status:503 });
  if (!allowed) return NextResponse.json({ error:'Too many requests' },{ status:429 });
  const { data,error:pushError } = await invokeServerFunction(supabaseAdmin, 'send-push-notification',
    { userId:user.id,payload:{ title:'Yrdly push test',body:'Your push notifications are working.',url:'/home' } });
  return NextResponse.json({ success:!pushError && data?.success === true });
}
