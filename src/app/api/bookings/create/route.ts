import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';

export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !body.serviceId || !body.businessId || !Number.isFinite(Date.parse(body.appointmentTime)) ||
      Date.parse(body.appointmentTime) <= Date.now() || (body.notes && (typeof body.notes !== 'string' || body.notes.length > 5000))) {
    return NextResponse.json({ error: 'Invalid booking details' }, { status: 400 });
  }
  const { data: service, error: serviceError } = await supabaseAdmin.from('service_offerings')
    .select('business_id,duration_minutes,is_active').eq('id', body.serviceId).single();
  if (serviceError || !service?.is_active || service.business_id !== body.businessId) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 400 });
  }
  if (body.staffId) {
    const { data: staff } = await supabaseAdmin.from('business_staff').select('id')
      .eq('id', body.staffId).eq('business_id', body.businessId).eq('is_active', true).maybeSingle();
    if (!staff) return NextResponse.json({ error: 'Staff unavailable' }, { status: 400 });
  }
  // Quotes have a separate ownership-checked checkout route.
  if (body.quoteId) return NextResponse.json({ error: 'Use quote checkout to book an accepted quote.' }, { status: 400 });
  const endTime = new Date(Date.parse(body.appointmentTime) + (service.duration_minutes || 60) * 60000).toISOString();
  const { data, error: insertError } = await supabaseAdmin.from('bookings').insert({
    customer_id: user.id, business_id: service.business_id, service_id: body.serviceId,
    staff_id: body.staffId || null, appointment_time: body.appointmentTime, end_time: endTime,
    notes: body.notes || null, status: 'requested', payment_status: 'unpaid',
  }).select('*,service:service_offerings(*),business:businesses(*)').single();
  if (insertError) {
    if (insertError.code === '23P01') return NextResponse.json({ error: 'This appointment is no longer available. Please choose another time.' }, { status: 409 });
    const errors: Record<string, string> = {
      booking_outside_hours: 'Choose an appointment during the available working hours.',
      booking_duration_invalid: 'This appointment time is invalid. Please choose another slot.',
      booking_staff_unavailable: 'This staff member is unavailable.',
      booking_staff_unassigned: 'This staff member does not offer the selected service.',
      booking_staff_required: 'Choose a staff member for this service.',
      booking_service_unavailable: 'This service is unavailable.',
      booking_business_unavailable: 'This business is unavailable for bookings.',
      booking_self_not_allowed: 'You cannot book your own business.',
    };
    const message = Object.entries(errors).find(([key]) => insertError.message?.includes(key))?.[1];
    if (message) return NextResponse.json({ error: message }, { status: 400 });
    console.error('[Bookings] Could not create booking', { code: insertError.code });
    return NextResponse.json({ error: 'Could not create booking' }, { status: 500 });
  }
  return NextResponse.json({ data });
}
