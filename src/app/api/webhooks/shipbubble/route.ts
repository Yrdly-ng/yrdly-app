import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { shipmentStatuses, syncShipbubbleStatus } from '@/lib/marketplace/shipbubble-tracking';
import { deliveryOperationsEnabled, shipbubbleQuoteConfig } from '@/lib/marketplace/shipbubble-quote';

export async function POST(request: Request) {
  const config = shipbubbleQuoteConfig();
  if (!deliveryOperationsEnabled(config)) return new Response(null, { status: 404 });
  const signature = request.headers.get('x-ship-signature');
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return new Response(null, { status: 401 });

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > 64 * 1024) return new Response(null, { status: 413 });
  const expected = createHmac('sha512', config.key).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return new Response(null, { status: 401 });

  let event;
  try { event = JSON.parse(body.toString('utf8')); } catch { return new Response(null, { status: 400 }); }
  if (typeof event?.order_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(event.order_id) ||
    !shipmentStatuses.includes(event.status)) return new Response(null, { status: 400 });

  const synced = await syncShipbubbleStatus(event.order_id, event.status);
  return synced ? NextResponse.json({ ok: true }) : new Response(null, { status: 503 });
}
