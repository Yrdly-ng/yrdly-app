import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { approveBookingMilestone } from '@/lib/bookings/milestone-release';
import { BookingCheckoutError } from '@/lib/bookings/booking-payments';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || body?.confirm !== true || ![1,2].includes(body.position)) {
    return NextResponse.json({ error: 'Explicit approval of a booking milestone is required.' }, { status: 400 });
  }
  const rate = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id:user.id,p_endpoint:'/api/bookings/milestones/approve',p_max_requests:5,p_window_seconds:60,
  });
  if(rate.error)return NextResponse.json({error:'Approval authorization is unavailable.'},{status:503});
  if(!rate.data)return NextResponse.json({error:'Please wait before checking this release again.'},{status:429,headers:{'Retry-After':'60'}});
  try { return NextResponse.json(await approveBookingMilestone(id, user.id, body.position)); }
  catch (failure) {
    return NextResponse.json({ error: failure instanceof BookingCheckoutError ? failure.message : 'Release needs verification. Check the booking before trying again.' },
      { status: failure instanceof BookingCheckoutError ? failure.status : 503 });
  }
}
