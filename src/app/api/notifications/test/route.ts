import { NextRequest,NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { invokeServerFunction } from '@/lib/notifications/server-functions';
export async function POST(request:NextRequest) {
  const { data:{ user },error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error:'Invalid session' },{ status:error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401 });
  const { data:allowed,error:limitError } = await supabaseAdmin.rpc('consume_rate_limit',{ p_user_id:user.id,p_endpoint:'/api/notifications/test',p_max_requests:3,p_window_seconds:60 });
  if (limitError) return NextResponse.json({ error:'Try again later' },{ status:503 });
  if (!allowed) return NextResponse.json({ error:'Too many requests' },{ status:429 });
  const { data,error:pushError } = await invokeServerFunction(supabaseAdmin, 'send-push-notification',
    { userId:user.id,channel:'web',type:'push_test',payload:{ title:'YRDLY web push test',body:'This is a test notification for your browser.',url:'/home' } });
  const webAccepted = typeof data?.webSent === 'number' ? data.webSent : 0;
  return NextResponse.json({
    success: !pushError && webAccepted > 0,
    webAccepted,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
