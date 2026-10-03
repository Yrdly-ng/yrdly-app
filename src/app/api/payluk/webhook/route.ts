import { NextRequest, NextResponse } from 'next/server';
import { handlePaylukWebhookEvent } from '@/lib/booking-payments';
import { verifyPaylukWebhookSignature } from '@/lib/payluk-webhook';

export async function POST(req: NextRequest) {
  const secret = process.env.PAYLUK_SECRET_KEY || process.env.PAYLUK_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get('x-payluk-signature');
  if (!verifyPaylukWebhookSignature(raw, sig, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try { await handlePaylukWebhookEvent(payload); } catch (e) {
    console.error('Booking webhook handling failed', e);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
