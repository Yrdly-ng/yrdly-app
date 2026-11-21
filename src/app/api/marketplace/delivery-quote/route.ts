import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { deliveryCheckoutEnabled, getShipbubblePickupQuote, sealDeliveryQuote, ShipbubbleQuoteError, shipbubbleQuoteConfig } from '@/lib/marketplace/shipbubble-quote';

const quoteRequest = z.object({
  itemId: z.string().uuid(),
  name: z.string().trim().min(3).max(100),
  phone: z.string().trim().regex(/^(?:\+234|0)[789][01]\d{8}$/),
  address: z.string().trim().min(12).max(300),
});

export async function POST(request: Request) {
  const config = shipbubbleQuoteConfig();
  if (!config) return NextResponse.json({ error: 'Delivery preview is unavailable.' }, { status: 404 });

  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (!user || error) return NextResponse.json({ error: 'Sign in to get a delivery quote.' }, { status: error?.status === 503 ? 503 : error?.status === 403 ? 403 : 401 });

  const parsed = quoteRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !user.email) {
    return NextResponse.json({ error: 'Enter your name, a valid Nigerian mobile number, and the full Lagos delivery address.' }, { status: 400 });
  }
  const { itemId, ...recipient } = parsed.data;
  if (itemId !== config.listingId) return NextResponse.json({ error: 'Delivery preview is unavailable for this item.' }, { status: 404 });

  const { data: withinLimit, error: rateError } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id,
    p_endpoint: '/api/marketplace/delivery-quote',
    p_max_requests: 4,
    p_window_seconds: 60,
  });
  if (rateError) return NextResponse.json({ error: 'Delivery quotes are temporarily unavailable.' }, { status: 503 });
  if (!withinLimit) return NextResponse.json({ error: 'Wait a minute before requesting another quote.' }, { status: 429 });

  const { data: item, error: itemError } = await supabaseAdmin.from('catalog_items')
    .select('title, price, in_stock, businesses!inner(owner_id)').eq('id', itemId).maybeSingle();
  if (itemError) return NextResponse.json({ error: 'Delivery quotes are temporarily unavailable.' }, { status: 503 });
  if (!item || !item.in_stock || !Number.isFinite(Number(item.price)) || Number(item.price) <= 0) {
    return NextResponse.json({ error: 'This product is unavailable for delivery.' }, { status: 404 });
  }
  const business = Array.isArray(item.businesses) ? item.businesses[0] : item.businesses;
  if (!business || business.owner_id === user.id) {
    return NextResponse.json({ error: 'This product is unavailable for delivery.' }, { status: 404 });
  }

  try {
    const quote = await getShipbubblePickupQuote(config, { ...recipient, email: user.email }, { name: item.title, price: Number(item.price) });
    if (!quote) return NextResponse.json({ error: 'No courier pickup quote is available for this address.' }, { status: 422 });
    const { provider, ...publicQuote } = quote;
    const token = provider && deliveryCheckoutEnabled(config) ? sealDeliveryQuote(config, {
      buyerId: user.id, itemId, priceKobo: Math.round(Number(item.price) * 100), feeKobo: quote.feeKobo,
      expiresAt: Date.now() + 15 * 60_000, provider,
    }) : undefined;
    return NextResponse.json({ ...publicQuote, token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ShipbubbleQuoteError && error.reason === 'invalid_address') {
      return NextResponse.json({ error: 'Enter a verifiable Lagos delivery address.' }, { status: 422 });
    }
    return NextResponse.json({ error: 'Delivery quotes are temporarily unavailable.' }, { status: 503 });
  }
}
