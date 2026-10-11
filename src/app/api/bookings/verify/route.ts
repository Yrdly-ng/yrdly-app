import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { BookingCheckoutError, verifyBookingCheckout } from '@/lib/booking-payments';

export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: error?.status === 503 ? 503 : error?.status === 403 ? 403 : 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.bookingId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.bookingId)) {
    return NextResponse.json({ error: 'A valid booking ID is required' }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, ...await verifyBookingCheckout(body.bookingId, user.id) });
  } catch (failure) {
    if (failure instanceof BookingCheckoutError) return NextResponse.json({ error: failure.message }, { status: failure.status });
    return NextResponse.json({ error: 'Booking payment could not be confirmed. Check your booking before paying again.' }, { status: 503 });
  }
}
