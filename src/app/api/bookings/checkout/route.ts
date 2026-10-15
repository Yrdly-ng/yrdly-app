import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { BookingCheckoutError, computeDepositAmount, createCheckoutForBooking } from '@/lib/bookings/booking-payments';
import { isPaidPrice, MINIMUM_PRICE_MESSAGE } from '@/lib/marketplace/price-policy';

export async function POST(req: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(req);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: authError?.status === 503 ? 503 : authError?.status === 403 ? 403 : 401 });
  const body = await req.json().catch(() => null);
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      (body.bookingId != null && (typeof body.bookingId !== 'string' || !uuid.test(body.bookingId))) ||
      (body.quoteId != null && (typeof body.quoteId !== 'string' || !uuid.test(body.quoteId))) ||
      (body.type != null && !['deposit','full','escrow'].includes(body.type))) {
    return NextResponse.json({ error: 'Invalid booking checkout request' }, { status: 400 });
  }
  const { data: permitted, error: rateError } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id, p_endpoint: '/api/bookings/checkout', p_max_requests: 10, p_window_seconds: 60,
  });
  if (rateError) return NextResponse.json({ error: 'Unable to authorize checkout' }, { status: 503 });
  if (!permitted) return NextResponse.json({ error: 'Too many checkout requests' }, { status: 429 });
  const { bookingId, type, quoteId } = body as { bookingId?: string; type?: 'deposit'|'full'|'escrow'; quoteId?: string };
  let resolvedBookingId = bookingId;
  // Quotes -> Bookings: if quoteId supplied without bookingId, convert quote to booking first (4C)
  if (!resolvedBookingId && quoteId) {
    const { data: quote } = await supabaseAdmin.from('quote_requests').select('id, customer_id, business_id, staff_id, status, converted_booking_id, estimated_price, expires_at').eq('id', quoteId).single();
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    if ((quote as any).customer_id !== user.id) return NextResponse.json({ error: 'Forbidden quote' }, { status: 403 });
    if (!['accepted', 'converted'].includes(quote.status) || !isPaidPrice(Number(quote.estimated_price)) ||
        (quote.expires_at && new Date(quote.expires_at).getTime() < Date.now())) {
      return NextResponse.json({ error: 'An accepted, unexpired estimate is required before checkout' }, { status: 409 });
    }
    if ((quote as any).converted_booking_id) { (resolvedBookingId as any) = (quote as any).converted_booking_id; }
    else {
      const { data: services } = await supabaseAdmin.from('service_offerings').select('id, duration_minutes').eq('business_id', (quote as any).business_id).eq('is_active', true).limit(1);
      const svcId = services?.[0]?.id; if (!svcId) return NextResponse.json({ error: 'No active service for business' }, { status: 400 });
      const appt = (body as any).appointmentTime || new Date(Date.now()+ 24*60*60*1000).toISOString();
      const appointment = new Date(appt);
      if (!Number.isFinite(appointment.getTime()) || appointment.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'Choose a future appointment time' }, { status: 400 });
      }
      const endTime = new Date(appointment.getTime() + (services![0].duration_minutes || 60) * 60_000).toISOString();
      const { data: b, error: createError } = await supabaseAdmin.from('bookings')
        .insert([{ customer_id: user.id, business_id: quote.business_id, service_id: svcId,
          appointment_time: appt, end_time: endTime, staff_id: quote.staff_id, quote_id: quoteId, status: 'requested' }])
        .select('id').single();
      if (createError || !b) return NextResponse.json({ error: 'Failed to create booking from quote' }, { status: 500 });
      const { data: converted, error: convertError } = await supabaseAdmin.from('quote_requests')
        .update({ status: 'converted', converted_booking_id: b.id })
        .eq('id', quoteId).eq('status', 'accepted').is('converted_booking_id', null)
        .select('id');
      if (convertError || !converted?.length) {
        await supabaseAdmin.from('bookings').delete().eq('id', b.id);
        return NextResponse.json({ error: 'Quote conversion changed; retry checkout' }, { status: 409 });
      }
      resolvedBookingId = (b as any).id;
    }
  }
  if (!resolvedBookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  const { data: booking } = await supabaseAdmin.from('bookings')
    .select('id, customer_id, service_id, business_id, appointment_time, payment_status, status, quote_id')
    .eq('id', resolvedBookingId).single();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if (booking.customer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!['requested', 'confirmed'].includes(booking.status) || new Date(booking.appointment_time).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'This booking is no longer payable' }, { status: 409 });
  }
  if (['deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released'].includes(booking.payment_status)) {
    return NextResponse.json({ error: 'This booking has already been paid' }, { status: 409 });
  }
  const { data: service } = await supabaseAdmin.from('service_offerings')
    .select('name, price, deposit_required, deposit_amount, deposit_percent, requires_full_payment, escrow_enabled')
    .eq('id', booking.service_id).single();
  if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 });
  const { data: business } = await supabaseAdmin.from('businesses')
    .select('owner_id, name').eq('id', booking.business_id).single();
  if (!business?.owner_id) return NextResponse.json({ error: 'Business owner not found' }, { status: 404 });
  if (type && !['deposit', 'full', 'escrow'].includes(type)) {
    return NextResponse.json({ error: 'Invalid payment type' }, { status: 400 });
  }
  const chosen: 'deposit'|'full'|'escrow' | null = booking.quote_id ? 'full' : service.escrow_enabled ? 'escrow' : service.requires_full_payment ? 'full' : service.deposit_required ? 'deposit' : null;
  if (!chosen || (type && type !== chosen)) {
    return NextResponse.json({ error: 'Use the payment type configured for this service' }, { status: 409 });
  }
  let amount: number | null = null;
  if (chosen==='full' || chosen==='escrow') amount = service?.price ? Number(service.price) : null;
  else amount = computeDepositAmount(service as any) ?? (service?.price ? Number(service.price) : null);
  if (booking.quote_id) {
    const { data: quote } = await supabaseAdmin.from('quote_requests')
      .select('customer_id, status, estimated_price, expires_at')
      .eq('id', booking.quote_id).single();
    if (!quote || quote.customer_id !== user.id || quote.status !== 'converted' ||
        !isPaidPrice(Number(quote.estimated_price)) ||
        (quote.expires_at && new Date(quote.expires_at).getTime() < Date.now())) {
      return NextResponse.json({ error: 'This booking needs a valid accepted quote' }, { status: 409 });
    }
    amount = Number(quote.estimated_price);
  }
  if (!isPaidPrice(amount)) return NextResponse.json({ error: MINIMUM_PRICE_MESSAGE }, { status: 400 });
  try {
    const res = await createCheckoutForBooking({
      bookingId: resolvedBookingId,
      buyerId: user.id,
      sellerId: business.owner_id,
      amount,
      type: chosen,
      purpose: `${service.name || 'Service booking'} — ${business.name || 'Yrdly business'}`,
      appointmentTime: booking.appointment_time,
    });
    return NextResponse.json({ ok: true, ...res, type: chosen, bookingId: resolvedBookingId });
  } catch (error) {
    if (error instanceof BookingCheckoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[BookingCheckout] Could not initialize payment:', error);
    return NextResponse.json({ error: 'Could not initialize booking payment. Please try again.' }, { status: 502 });
  }
}
