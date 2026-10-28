import { NextRequest, NextResponse } from 'next/server';
import { reconcilePaystackTicketOrders } from '@/lib/events/paystack-ticket-service';
import { reconcilePaystackEventFinance } from '@/lib/events/paystack-event-finance';
import { getPaystackEventMode } from '@/lib/payments/paystack-service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    if (!getPaystackEventMode()) return NextResponse.json({ enabled: false });
    return NextResponse.json({ ...await reconcilePaystackTicketOrders(), ...await reconcilePaystackEventFinance() });
  } catch {
    return NextResponse.json({ error: 'Paystack reconciliation requires retry' }, { status: 503 });
  }
}
