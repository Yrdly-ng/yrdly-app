import { NextRequest, NextResponse } from 'next/server';
import { acceptPaystackEventWebhook } from '@/lib/events/paystack-ticket-service';
import { verifyPaystackSignature } from '@/lib/payments/paystack-service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 512_000) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  if (!verifyPaystackSignature(raw, request.headers.get('x-paystack-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  try {
    await acceptPaystackEventWebhook(raw);
    return NextResponse.json({ received: true });
  } catch {
    // Do not acknowledge unprocessed financial events. Paystack retries; the
    // persisted inbox also supports recovery after the provider retry window.
    return NextResponse.json({ error: 'Webhook processing requires retry' }, { status: 503 });
  }
}
