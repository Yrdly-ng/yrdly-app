import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { BookingCheckoutError, cancelBookingCheckout } from '@/lib/bookings/booking-payments';

export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: error?.status === 503 ? 503 : error?.status === 403 ? 403 : 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.transactionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.transactionId)) {
    return NextResponse.json({ error: 'A valid transaction ID is required' }, { status: 400 });
  }
  try {
    await cancelBookingCheckout(body.transactionId, user.id);
    return NextResponse.json({ success: true });
  } catch (failure) {
    if (failure instanceof BookingCheckoutError) return NextResponse.json({ error: failure.message }, { status: failure.status });
    return NextResponse.json({ error: 'Booking cancellation needs review. Check your booking before paying again.' }, { status: 502 });
  }
}
