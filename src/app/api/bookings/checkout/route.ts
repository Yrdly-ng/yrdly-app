import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computeDepositAmount, createCheckoutForBooking } from '@/lib/booking-payments';

export async function POST(req: NextRequest) {
  const { data: { user } } = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const { bookingId, type, quoteId } = body as { bookingId?: string; type?: 'deposit'|'full'|'escrow'; quoteId?: string };
  let resolvedBookingId = bookingId;
  // Quotes -> Bookings: if quoteId supplied without bookingId, convert quote to booking first (4C)
  if (!resolvedBookingId && quoteId) {
    const { data: quote } = await supabaseAdmin.from('quote_requests').select('id, customer_id, business_id, staff_id, status').eq('id', quoteId).single();
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    if ((quote as any).customer_id !== user.id) return NextResponse.json({ error: 'Forbidden quote' }, { status: 403 });
    if ((quote as any).converted_booking_id) { (resolvedBookingId as any) = (quote as any).converted_booking_id; }
    else {
      const { data: services } = await supabaseAdmin.from('service_offerings').select('id, duration_minutes').eq('business_id', (quote as any).business_id).eq('is_active', true).limit(1);
      const svcId = services?.[0]?.id; if (!svcId) return NextResponse.json({ error: 'No active service for business' }, { status: 400 });
      const appt = (body as any).appointmentTime || new Date(Date.now()+ 24*60*60*1000).toISOString();
      // compute end_time
      const { data: b } = await supabaseAdmin.from('bookings').insert([{ customer_id: user.id, business_id: (quote as any).business_id, service_id: svcId, appointment_time: appt, staff_id: (quote as any).staff_id, quote_id: quoteId }]).select('*').single();
      if (!b) return NextResponse.json({ error: 'Failed to create booking from quote' }, { status: 500 });
      await supabaseAdmin.from('quote_requests').update({ status: 'converted', converted_booking_id: (b as any).id }).eq('id', quoteId);
      resolvedBookingId = (b as any).id;
    }
  }
  if (!resolvedBookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  const { data: booking } = await supabaseAdmin.from('bookings').select('id, customer_id, service_id').eq('id', resolvedBookingId).single();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if (booking.customer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data: service } = await supabaseAdmin.from('service_offerings').select('price, deposit_required, deposit_amount, deposit_percent, requires_full_payment, escrow_enabled').eq('id', booking.service_id).single();
  const chosen: 'deposit'|'full'|'escrow' = type || (service?.escrow_enabled ? 'escrow' : service?.requires_full_payment ? 'full' : 'deposit');
  let amount: number | null = null;
  if (chosen==='full' || chosen==='escrow') amount = service?.price ? Number(service.price) : null;
  else amount = computeDepositAmount(service as any) ?? (service?.price ? Number(service.price) : null);
  if (!amount) return NextResponse.json({ error: 'No amount configured' }, { status: 400 });
  const { data: prof } = await supabaseAdmin.from('users').select('payluk_customer_id, email').eq('id', user.id).single();
  const res = await createCheckoutForBooking({ bookingId: resolvedBookingId!, amount, type: chosen, customerPaylukId: (prof as any)?.payluk_customer_id, email: (prof as any)?.email });
  return NextResponse.json({ ok: true, ...res, amount, type: chosen, bookingId: resolvedBookingId });
}
