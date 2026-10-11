import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { cancelTicketCheckout, TicketCheckoutError } from '@/lib/ticket-checkout';

export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: error?.status === 503 ? 503 : error?.status === 403 ? 403 : 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.transactionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.transactionId)) {
    return NextResponse.json({ error: 'A valid transaction ID is required' }, { status: 400 });
  }
  try {
    await cancelTicketCheckout(body.transactionId, user.id);
    return NextResponse.json({ success: true });
  } catch (failure) {
    if (failure instanceof TicketCheckoutError) return NextResponse.json({ error: failure.message }, { status: failure.status });
    return NextResponse.json({ error: 'Cancellation needs review. Your reservation is still held.' }, { status: 502 });
  }
}
