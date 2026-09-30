import { NextRequest, NextResponse } from 'next/server';
import { handlePaylukWebhookEvent, verifyHmac } from '@/lib/booking-payments';

export async function POST(req: NextRequest) {
  const secret = process.env.PAYLUK_WEBHOOK_SECRET || process.env.PAYLUK_SECRET_KEY || '';
  const raw = await req.text();
  const sig = req.headers.get('x-payluk-signature') || req.headers.get('x-webhook-signature') || req.headers.get('payluk-signature') || '';
  if (secret && sig) {
    const ok = verifyHmac(raw, sig, secret);
    if (!ok) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }
  let payload: any;
  try { payload = JSON.parse(raw); } catch { payload = {}; }
  try { await handlePaylukWebhookEvent(payload); } catch (e) { console.error('webhook handle error', e); }
  return NextResponse.json({ received: true });
}
