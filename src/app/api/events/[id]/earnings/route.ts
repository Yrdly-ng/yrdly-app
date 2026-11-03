import { paylukEventFinanceEnabled } from '@/lib/events/payluk-event-finance-config';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { EventFinanceError, getEventEarnings, reconcileEventWithdrawal } from '@/lib/events/paystack-event-finance';

import { getPaylukEventEarnings, reconcilePaylukEventWithdrawal } from '@/lib/events/payluk-event-finance';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { data: { user }, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: error?.status || 401 });
    const { id } = await params;
    const provider = request.nextUrl.searchParams.get('provider') || 'payluk';
    if (!['payluk', 'paystack'].includes(provider)) return NextResponse.json({ error: 'Invalid payment provider.' }, { status: 400 });
    if (provider === 'payluk') {
      const summary = await getPaylukEventEarnings(id, user.id);
      if (request.nextUrl.searchParams.get('refresh') === 'true' && paylukEventFinanceEnabled()) {
        for (const withdrawal of summary.withdrawals.filter(w => ['submitting','pending'].includes(w.status)).slice(0, 2)) await reconcilePaylukEventWithdrawal(withdrawal.reference, user.id);
        return NextResponse.json(await getPaylukEventEarnings(id, user.id));
      }
      return NextResponse.json(summary);
    }
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
