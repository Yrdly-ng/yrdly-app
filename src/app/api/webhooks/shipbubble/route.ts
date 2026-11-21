import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { shouldAdvanceShipment, shipmentStatuses, type ShipmentStatus } from '@/lib/marketplace/shipbubble-dispatch';
import { deliveryCheckoutEnabled, shipbubbleQuoteConfig } from '@/lib/marketplace/shipbubble-quote';

export async function POST(request: Request) {
  const config = shipbubbleQuoteConfig();
  if (!deliveryCheckoutEnabled(config)) return new Response(null, { status: 404 });
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

  const table = supabaseAdmin.from('escrow_transactions');
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await table.select('id,status,delivery_details')
      .eq('delivery_details->>option', 'shipbubble').eq('delivery_details->>shipment_id', event.order_id).maybeSingle();
    if (found.error) return new Response(null, { status: 503 });
    if (!found.data) return new Response(null, { status: 503 });
    const tx = found.data;
    const details = tx.delivery_details;
    if (!shouldAdvanceShipment(details.delivery_status, event.status as ShipmentStatus)) return NextResponse.json({ ok: true });
    const now = new Date().toISOString();
    const updated = await table.update({
      delivery_details: { ...details, delivery_status: event.status },
      updated_at: now,
      ...(event.status === 'completed' && tx.status === 'paid' ? { status: 'shipped', shipped_at: now } : {}),
    }).eq('id', tx.id).eq('status', tx.status)
      .eq('delivery_details->>delivery_status', details.delivery_status).select('id').maybeSingle();
    if (updated.error) return new Response(null, { status: 503 });
    if (updated.data) return NextResponse.json({ ok: true });
  }
  return new Response(null, { status: 503 });
}
