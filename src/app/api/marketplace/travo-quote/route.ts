import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { quoteTravoDelivery, signTravoQuote, travoCheckoutEnabled, travoSettings, TravoRequestError } from '@/lib/marketplace/travo-delivery';

const input = z.object({ itemId: z.string().uuid(), address: z.string().trim().min(12).max(300) });

export async function POST(request: Request) {
  const settings = travoSettings();
  if (!settings) return NextResponse.json({ error: 'Delivery quotes are unavailable.' }, { status: 404 });
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (!user || error) return NextResponse.json({ error: 'Sign in to get a quote.' }, { status: error?.status === 503 ? 503 : 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter a full Lagos delivery address.' }, { status: 400 });
  const { itemId, address } = parsed.data;
  if (itemId !== settings.listingId) return NextResponse.json({ error: 'Delivery is unavailable for this listing.' }, { status: 404 });

  const limit = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id, p_endpoint: '/api/marketplace/travo-quote', p_max_requests: 4, p_window_seconds: 60,
  });
  if (limit.error) return NextResponse.json({ error: 'Delivery quotes are temporarily unavailable.' }, { status: 503 });
  if (!limit.data) return NextResponse.json({ error: 'Wait a minute before requesting another quote.' }, { status: 429 });
  const { data: item, error: itemError } = await supabaseAdmin.from('catalog_items')
    .select('price,in_stock,businesses!inner(owner_id)').eq('id', itemId).maybeSingle();
  if (itemError) return NextResponse.json({ error: 'Delivery quotes are temporarily unavailable.' }, { status: 503 });
  const business = Array.isArray(item?.businesses) ? item.businesses[0] : item?.businesses;
  const itemKobo = Math.round(Number(item?.price) * 100);
  if (!business || business.owner_id === user.id || !item?.in_stock || !Number.isSafeInteger(itemKobo) || itemKobo <= 0) {
    return NextResponse.json({ error: 'Delivery is unavailable for this listing.' }, { status: 404 });
  }
  try {
    const quote = await quoteTravoDelivery(settings, address);
    if (quote) {
      const { quoteId, feeKobo, expiresAt, dropoff } = quote;
      const token = travoCheckoutEnabled() ? signTravoQuote(settings, { quoteId, feeKobo, itemKobo, expiresAt, buyerId: user.id, itemId }) : undefined;
      return NextResponse.json({ feeKobo, expiresAt, dropoff, token }, { headers: { 'Cache-Control': 'no-store' } });
    }
  } catch (error) {
    if (!(error instanceof TravoRequestError) || error.status !== 422) {
      return NextResponse.json({ error: 'Delivery quotes are temporarily unavailable.' }, { status: 503 });
    }
  }
  return NextResponse.json({ error: 'No quote was available for that address. Enter a complete Lagos street address or choose another handoff.' }, { status: 422 });
}
