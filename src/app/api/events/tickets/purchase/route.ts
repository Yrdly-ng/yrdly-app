import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EVENT_CONSTANTS } from '@/lib/constants';

/**
 * POST /api/events/tickets/purchase
 * Initialises a Flutterwave payment for a ticket.
 * Returns a payment link — the client redirects the user there.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { event_id, tier_id, attendee_name, attendee_email, attendee_phone } = await request.json();

    if (!event_id || !tier_id || !attendee_name || !attendee_email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── Validate event & tier ────────────────────────────────────────────────
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, title, status, organizer_id, flutterwave_subaccount_id')
      .eq('id', event_id)
      .single();

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.status !== 'PUBLISHED') return NextResponse.json({ error: 'Event is not available' }, { status: 400 });
    if (event.organizer_id === user.id) return NextResponse.json({ error: 'Organizers cannot purchase their own tickets' }, { status: 400 });

    const { data: tier } = await supabaseAdmin
      .from('ticket_tiers')
      .select('id, name, price, capacity, sold, is_visible, sale_ends_at')
      .eq('id', tier_id)
      .eq('event_id', event_id)
      .single();

    if (!tier) return NextResponse.json({ error: 'Ticket tier not found' }, { status: 404 });
    if (!tier.is_visible) return NextResponse.json({ error: 'This ticket tier is not available' }, { status: 400 });
    if (tier.sale_ends_at && new Date(tier.sale_ends_at) < new Date()) {
      return NextResponse.json({ error: 'Ticket sales have ended for this tier' }, { status: 400 });
    }
    if (tier.capacity !== null && tier.sold >= tier.capacity) {
      return NextResponse.json({ error: 'SOLD_OUT', message: 'This ticket tier is sold out' }, { status: 409 });
    }

    // ── Free ticket — create directly, no payment needed ────────────────────
    if (tier.price === 0) {
      const ticketCode = `${EVENT_CONSTANTS.TICKET_CODE_PREFIX}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const qrData = JSON.stringify({ ticket_code: ticketCode, event_id, tier_id });

      const { data: ticket, error: ticketError } = await supabaseAdmin
        .from('tickets')
        .insert({
          buyer_id: user.id,
          event_id,
          tier_id,
          attendee_name,
          attendee_email,
          attendee_phone: attendee_phone || null,
          ticket_code: ticketCode,
          qr_data: qrData,
          status: 'PAID',
          amount_paid: 0,
        })
        .select('id')
        .single();

      if (ticketError) throw ticketError;

      // Increment sold count
      await supabaseAdmin
        .from('ticket_tiers')
        .update({ sold: tier.sold + 1 })
        .eq('id', tier_id);

      return NextResponse.json({ success: true, free: true, ticket_id: ticket.id });
    }

    // ── Paid ticket — initialise Flutterwave payment ─────────────────────────
    const txRef = `evt-${event_id.substring(0, 8)}-${Date.now()}`;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://yrdly-app.vercel.app';

    // Build payload — include split if organizer has a subaccount
    const flwPayload: any = {
      tx_ref: txRef,
      amount: tier.price,
      currency: 'NGN',
      redirect_url: `${appUrl}/api/events/tickets/verify?tx_ref=${txRef}`,
      payment_options: 'card,banktransfer,ussd,mobilemoney',
      customer: { 
        email: attendee_email, 
        name: attendee_name, 
        phone_number: attendee_phone || '' 
      },
      customizations: {
        title: event.title,
        description: `${tier.name} ticket`,
        logo: `${appUrl}/yrdly-logo.png`,
      },
      meta: {
        tx_ref: txRef,
        event_id,
        tier_id,
        buyer_id: user.id,
        attendee_name,
        attendee_email,
        attendee_phone: attendee_phone || '',
      },
    };

    // Add split payment if organizer has a subaccount
    if (event.flutterwave_subaccount_id) {
      const commissionPercent = Math.round(EVENT_CONSTANTS.COMMISSION_RATE * 100);
      flwPayload.subaccounts = [{
        id: event.flutterwave_subaccount_id,
        transaction_split_ratio: 100 - commissionPercent,
      }];
    }

    // Call Flutterwave API directly
    const flwRes = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(flwPayload),
    });

    const flwData = await flwRes.json();

    if (flwData.status !== 'success') {
      console.error('[v0] Flutterwave init error:', flwData);
      return NextResponse.json({ 
        error: 'Payment initialization failed',
        details: flwData.message || 'Flutterwave API error'
      }, { status: 502 });
    }

    return NextResponse.json({ success: true, payment_link: flwData.data.link, tx_ref: txRef });
  } catch (error) {
    console.error('[v0] Ticket purchase error:', error);
    if (error instanceof Error) {
      console.error('[v0] Error message:', error.message);
      console.error('[v0] Error stack:', error.stack);
    }
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
