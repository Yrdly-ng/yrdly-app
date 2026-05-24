import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/tickets/initialize
 * Initiates a Flutterwave checkout for ticket purchase.
 * Returns a payment link that opens the Flutterwave modal.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const body = await request.json();
    const { eventId, tierId, attendeeName, attendeeEmail, attendeePhone } = body;

    if (!eventId || !tierId || !attendeeName || !attendeeEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── Fetch event + tier ────────────────────────────────
    const { data: tier } = await supabaseAdmin
      .from('ticket_tiers')
      .select('*, event:events(id, title, status, payout_mode, flutterwave_subaccount_id, organizer_id)')
      .eq('id', tierId)
      .single();

    if (!tier || !tier.event) {
      return NextResponse.json({ error: 'Tier not found' }, { status: 404 });
    }
    if (tier.event.id !== eventId) {
      return NextResponse.json({ error: 'Tier does not belong to this event' }, { status: 400 });
    }
    if (tier.event.status !== 'PUBLISHED') {
      return NextResponse.json({ error: 'Event is not available for purchase' }, { status: 400 });
    }
    if (tier.capacity != null && tier.sold >= tier.capacity) {
      return NextResponse.json({ error: 'This ticket tier is sold out' }, { status: 409 });
    }

    // ── Build tx_ref carrying all data for webhook ────────
    const txRef = `ticket_${tierId}_${user.id}_${Date.now()}`;
    const price = Number(tier.price);

    // ── Free ticket — skip Flutterwave ────────────────────
    if (price === 0) {
      const { data: ticketId, error: rpcErr } = await supabaseAdmin.rpc('purchase_ticket', {
        p_tier_id: tierId,
        p_buyer_id: user.id,
        p_event_id: eventId,
        p_attendee_name: attendeeName,
        p_attendee_email: attendeeEmail,
        p_attendee_phone: attendeePhone || null,
        p_amount_paid: 0,
        p_tx_ref: txRef,
        p_flw_ref: null,
      });

      if (rpcErr) {
        if (rpcErr.message?.includes('TICKET_SOLD_OUT')) {
          return NextResponse.json({ error: 'Sold out' }, { status: 409 });
        }
        throw rpcErr;
      }

      return NextResponse.json({ success: true, free: true, ticketId });
    }

    // ── Paid ticket — build Flutterwave payload ───────────
    const payloadBase: any = {
      tx_ref: txRef,
      amount: price,
      currency: 'NGN',
      redirect_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/ticket-verify?tx_ref=${txRef}`,
      payment_options: 'card,banktransfer,ussd,mobilemoney',
      customer: {
        email: attendeeEmail,
        name: attendeeName,
        phone_number: attendeePhone || '',
      },
      customizations: {
        title: `Ticket — ${tier.event.title}`,
        description: `${tier.name} ticket`,
        logo: `${process.env.NEXT_PUBLIC_APP_URL}/yrdly-logo.png`,
      },
      meta: {
        tier_id: tierId,
        event_id: eventId,
        buyer_id: user.id,
        attendee_name: attendeeName,
        attendee_email: attendeeEmail,
        attendee_phone: attendeePhone || '',
      },
    };

    // Instant payout — add split
    if (tier.event.payout_mode === 'INSTANT' && tier.event.flutterwave_subaccount_id) {
      payloadBase.subaccounts = [
        {
          id: tier.event.flutterwave_subaccount_id,
          transaction_split_ratio: 95, // organizer gets 95%
        },
      ];
    }

    const flwRes = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloadBase),
    });

    const flwData = await flwRes.json();

    if (flwData.status !== 'success') {
      console.error('Flutterwave init error:', flwData);
      return NextResponse.json({ error: 'Payment initialization failed' }, { status: 502 });
    }

    return NextResponse.json({ success: true, paymentLink: flwData.data.link, txRef });
  } catch (error) {
    console.error('Ticket initialize error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
