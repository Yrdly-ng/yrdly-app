import { NextRequest, NextResponse } from 'next/server';
import { advanceNextPaylukEventWithdrawal } from '@/lib/events/payluk-event-finance';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** One bounded continuation. A dedicated credential cannot access other cron routes. */
export async function GET(request: NextRequest) {
  const secret = process.env.EVENT_PAYOUT_CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await advanceNextPaylukEventWithdrawal();
    return NextResponse.json({ success: true, ...result, checkedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: 'Event withdrawal processing needs another check.' }, { status: 503 });
  }
}
