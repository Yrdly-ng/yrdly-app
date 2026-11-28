import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getShipbubbleStatus, syncShipbubbleStatus } from '@/lib/marketplace/shipbubble-tracking';
import { deliveryOperationsEnabled, shipbubbleQuoteConfig } from '@/lib/marketplace/shipbubble-quote';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = shipbubbleQuoteConfig();
  if (!deliveryOperationsEnabled(config)) return NextResponse.json({ error: 'Delivery tracking is unavailable.' }, { status: 404 });
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Sign in to refresh delivery tracking.' }, { status: error?.status === 503 ? 503 : 401 });
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: 'Invalid order reference.' }, { status: 400 });

  const { data: tx, error: txError } = await supabaseAdmin.from('escrow_transactions')
    .select('buyer_id,seller_id,delivery_details').eq('id', id.data).maybeSingle();
  if (txError) return NextResponse.json({ error: 'Could not load delivery tracking.' }, { status: 503 });
  if (!tx || (tx.buyer_id !== user.id && tx.seller_id !== user.id) || tx.delivery_details?.option !== 'shipbubble') {
    return NextResponse.json({ error: 'Delivery order not found.' }, { status: 404 });
  }
  const shipmentId = tx.delivery_details.shipment_id;
  if (!shipmentId) return NextResponse.json({ error: 'The courier booking has no tracking reference yet.' }, { status: 409 });
  if (['completed', 'cancelled'].includes(tx.delivery_details.delivery_status)) return NextResponse.json({ ok: true });

  const limit = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id, p_endpoint: '/api/transactions/delivery', p_max_requests: 2, p_window_seconds: 60,
  });
  if (limit.error) return NextResponse.json({ error: 'Tracking refresh is temporarily unavailable.' }, { status: 503 });
  if (!limit.data) return NextResponse.json({ error: 'Wait a minute before refreshing tracking again.' }, { status: 429 });

  try {
    const status = await getShipbubbleStatus(config, shipmentId);
    if (status && await syncShipbubbleStatus(shipmentId, status)) return NextResponse.json({ ok: true });
  } catch { /* Keep the last known status while the provider is unavailable. */ }
  return NextResponse.json({ error: 'Could not refresh tracking. The last confirmed status is still shown.' }, { status: 503 });
}
