import { NextRequest,NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/** Recalculate from persisted bookings and approved appeals; never accept a client strike count. */
export async function POST(request:NextRequest) {
  try {
    const { data:{ user },error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error:'Invalid session' },{ status:error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401 });
    const { targetId,party } = await request.json();
    if (!['customer','provider'].includes(party) || typeof targetId !== 'string') return NextResponse.json({ error:'Invalid target' },{ status:400 });
    const { data:actor,error:actorError } = await supabaseAdmin.from('users').select('is_admin').eq('id',user.id).single();
    if (actorError) throw actorError;
    let authorized = actor?.is_admin || (party === 'customer' && targetId === user.id);
    if (!authorized) {
      if (party === 'provider') {
        const { data:business } = await supabaseAdmin.from('businesses').select('owner_id').eq('id',targetId).single();
        authorized = business?.owner_id === user.id;
      }
      if (!authorized) {
        const field = party === 'customer' ? 'customer_id' : 'business_id';
        const { data:bookings,error:bookingError } = await supabaseAdmin.from('bookings').select('customer_id,business:businesses(owner_id)').eq(field,targetId);
        if (bookingError) throw bookingError;
        authorized = bookings?.some(booking => party === 'provider' ? booking.customer_id === user.id : (booking.business as any)?.owner_id === user.id);
      }
    }
    if (!authorized) return NextResponse.json({ error:'Forbidden' },{ status:403 });
    const field = party === 'customer' ? 'customer_id' : 'business_id';
    const { data:bookings,error:bookingError } = await supabaseAdmin.from('bookings').select('id,status,cancelled_at,appointment_time,strike_party')
      .eq(field,targetId).in('status',['no_show','late_cancelled']).eq('strike_party',party);
    if (bookingError) throw bookingError;
    const rows = bookings || [];
    const { data:appeals,error:appealError } = rows.length ? await supabaseAdmin.from('strike_appeals').select('booking_id')
      .in('booking_id',rows.map(row => row.id)).eq('status','approved') : { data:[],error:null };
    if (appealError) throw appealError;
    const forgiven = new Set((appeals || []).map(appeal => appeal.booking_id));
    const cutoff = Date.now() - 90*86400000;
    const active = rows.filter(row => !forgiven.has(row.id) && Date.parse(row.status === 'no_show' ? row.appointment_time : row.cancelled_at) >= cutoff);
    const noShow = active.filter(row => row.status === 'no_show').length;
    const late = active.length-noShow;
    const isFlagged = active.length >= 3;
    const { error:updateError } = await supabaseAdmin.from(party === 'customer' ? 'users' : 'businesses')
      .update({ no_show_count:noShow,late_cancellation_count:late,is_flagged:isFlagged }).eq('id',targetId);
    if (updateError) throw updateError;
    return NextResponse.json({ isFlagged });
  } catch (error) {
    console.error('Booking flag recalculation failed:',error);
    return NextResponse.json({ error:'Could not refresh booking flags' },{ status:500 });
  }
}
