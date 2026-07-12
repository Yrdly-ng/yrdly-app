import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';
import { PaystackService } from '@/lib/paystack-service';

/**
 * POST /api/tickets/initialize
 * Initiates a Paystack checkout for ticket purchase.
 * Returns a payment link that opens the Paystack modal.
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
      .select('*, event:events(id, title, status, payout_mode, payment_subaccount_id, organizer_id)')
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
    const txRef = `evt-tkt-${tierId.substring(0,6)}-${user.id.substring(0,4)}-${Date.now()}`;
    const price = Number(tier.price);

    // ── Free ticket — skip Paystack ────────────────────
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

    // ── Paid ticket — initialise Paystack payment ───────────────────────────
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';
    
    // Check if we need to split payment
    let subaccount: string | undefined;
    if (tier.event.payout_mode === 'INSTANT' && tier.event.payment_subaccount_id) {
      subaccount = tier.event.payment_subaccount_id;
    }

    let paymentLink: string;
    try {
      paymentLink = await PaystackService.initializePayment({
        transactionId: txRef,
        amount: price,
        buyerEmail: attendeeEmail,
        buyerName: attendeeName,
        itemTitle: `Ticket — ${tier.event.title}`,
        sellerName: 'Event Organizer',
        callbackUrl: `${origin}/my-tickets?success=1`,
        metadata: {
          event_id: eventId,
          tier_id: tierId,
          buyer_id: user.id,
          attendee_name: attendeeName,
          attendee_email: attendeeEmail,
          attendee_phone: attendeePhone || null
        }
      });
      // NOTE: We don't currently pass 'subaccount' to PaystackService.initializePayment.
      // If INSTANT payout is needed, PaystackService.initializePayment should be updated to accept a subaccount param.
    } catch (paystackError: any) {
      console.error('Paystack init error:', paystackError);
      return NextResponse.json({ error: 'Payment initialization failed' }, { status: 502 });
    }

    return NextResponse.json({ success: true, paymentLink, txRef });
  } catch (error) {
    console.error('Ticket initialize error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
