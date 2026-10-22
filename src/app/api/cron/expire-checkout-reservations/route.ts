import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { CHECKOUT_RESERVATION_TTL_MS, expireCheckoutReservation, RESERVATION_SELECT } from '@/lib/payments/checkout-reservation-expiry';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Reuse the existing scheduler credential; this endpoint cannot withdraw funds.
  const secret = process.env.PAYOUT_RECOVERY_CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { data: localExpired, error: cleanupError } = await supabaseAdmin.rpc('expire_stale_checkout_reservations', { p_ttl_minutes: 10 });
    if (cleanupError) throw cleanupError;
    const { data, error } = await supabaseAdmin.from('escrow_transactions')
      .select(RESERVATION_SELECT).in('item_type', ['post', 'catalog_item'])
      .in('status', ['pending', 'creating_escrow', 'reconciling'])
      .not('payluk_tx_ref', 'is', null).not('payluk_escrow_id', 'is', null)
      .lte('created_at', new Date(Date.now() - CHECKOUT_RESERVATION_TTL_MS).toISOString())
      .order('created_at', { ascending: true }).limit(2);
    if (error) throw error;
    let providerExpired = 0;
    // Bound provider traffic: at most two expirations (six Payluk requests).
    for (const reservation of data || []) {
      if (await expireCheckoutReservation(reservation)) providerExpired++;
    }
    return NextResponse.json({ localExpired: localExpired || 0, providerExpired });
  } catch (error) {
    console.error('[CheckoutExpiry] Cleanup failed', error);
    return NextResponse.json({ error: 'Checkout cleanup failed' }, { status: 503 });
  }
}
