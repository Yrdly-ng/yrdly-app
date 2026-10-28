import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { EventFinanceError, getEventEarnings, reconcileEventWithdrawal } from '@/lib/events/paystack-event-finance';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { data: { user }, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: error?.status || 401 });
    const { id } = await params;
    const summary = await getEventEarnings(id, user.id);
    // Reconcile existing requests only. Reading earnings never starts a transfer.
    if (request.nextUrl.searchParams.get('refresh') === 'true') {
      await Promise.all(summary.withdrawals.filter(w => ['submitting', 'pending', 'otp'].includes(w.status)).map(w => reconcileEventWithdrawal(w.reference)));
      return NextResponse.json(await getEventEarnings(id, user.id));
    }
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json({ error: error instanceof EventFinanceError ? error.message : 'Event earnings are temporarily unavailable.' }, { status: error instanceof EventFinanceError ? error.status : 503 });
  }
}
