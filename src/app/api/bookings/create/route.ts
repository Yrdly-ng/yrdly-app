import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

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
  if (insertError) return NextResponse.json({ error: 'Could not create booking' }, { status: 500 });
  return NextResponse.json({ data });
}
