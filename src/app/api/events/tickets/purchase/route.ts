import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EVENT_CONSTANTS } from '@/lib/constants';
import { ResendEmailService } from '@/lib/resend-service';
import QRCode from 'qrcode';
import { getPostHogClient } from '@/lib/posthog-server';
import { PaystackService } from '@/lib/paystack-service';

/**
 * POST /api/events/tickets/purchase
 * Initialises a Paystack payment for a ticket.
 * Returns a payment link — the client redirects the user there.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { event_id, tier_id, attendee_name, attendee_email, attendee_phone, callbackUrl, quantity: rawQuantity } = await request.json();
    const quantity = Math.max(1, parseInt(rawQuantity || '1', 10));

    if (!event_id || !tier_id || !attendee_name || !attendee_email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── Validate event & tier ────────────────────────────────────────────────
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, title, status, organizer_id, payment_subaccount_id, end_time')
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
    if (tier.capacity !== null && (tier.sold + quantity) > tier.capacity) {
      return NextResponse.json({ error: 'SOLD_OUT', message: `Not enough tickets left. Only ${Math.max(0, tier.capacity - tier.sold)} available.` }, { status: 409 });
    }

    // ── Free ticket — create directly, no payment needed ────────────────────
    if (tier.price === 0) {
      const ticketsToInsert = [];
      const qrDataUrls = [];
      
      for (let i = 0; i < quantity; i++) {
        const ticketCode = `${EVENT_CONSTANTS.TICKET_CODE_PREFIX}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const qrData = JSON.stringify({ ticket_code: ticketCode, event_id, tier_id });
        ticketsToInsert.push({
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
          expires_at: event.end_time || null,
        });
      }

      const { data: insertedTickets, error: ticketError } = await supabaseAdmin
        .from('tickets')
        .insert(ticketsToInsert)
        .select('id, ticket_code, qr_data');

      if (ticketError) throw ticketError;

      // Increment sold count
      await supabaseAdmin
        .from('ticket_tiers')
        .update({ sold: tier.sold + quantity })
        .eq('id', tier_id);

      // Increment event attendee_count
      try {
        const { data: eData } = await supabaseAdmin.from('events').select('attendee_count').eq('id', event_id).single();
        if (eData) {
          await supabaseAdmin.from('events').update({ attendee_count: (eData.attendee_count || 0) + quantity }).eq('id', event_id);
        }
      } catch (e) {}

      // ── Send confirmation email to buyer ────────────────────────────────
      // We will send one email for the first ticket for simplicity, or we could send an email per ticket.
      // For now, let's just generate the first ticket's QR code and send the email for it to avoid spam.
      // In a real scenario, the email template should support multiple tickets or we send multiple emails.
      // Let's send one email per ticket to be safe so they get all QRs.
      try {
        const resendStatus = ResendEmailService.getConfigurationStatus();
        if (ResendEmailService.isConfigured()) {
          const { data: fullEvent } = await supabaseAdmin
            .from('events')
            .select('id, title, start_time, location_address, state, organizer_id')
            .eq('id', event_id)
            .single();

          if (fullEvent) {
            const startDate = new Date(fullEvent.start_time);
            
            for (const ticket of insertedTickets) {
              const qrDataUrl = await QRCode.toDataURL(ticket.qr_data, { width: 300, margin: 2 });
              await ResendEmailService.sendTicketConfirmationEmail(
                attendee_name,
                attendee_email,
                event.title,
                tier.name,
                ticket.id,
                qrDataUrl,
                startDate.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
                startDate.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
                fullEvent.location_address || fullEvent.state || 'See event details',
                `FREE-${ticket.ticket_code}`
              );
            }

            // ── Send organizer notification ─────────────────────────────────
            try {
              const { data: organizer } = await supabaseAdmin
                .from('users')
                .select('email, username')
                .eq('id', fullEvent.organizer_id)
                .single();

              if (organizer?.email) {
                try {
                  const { data: paidTickets } = await supabaseAdmin
                    .from('tickets')
                    .select('amount_paid')
                    .eq('event_id', event_id)
                    .eq('status', 'PAID');

                  const totalSold = (paidTickets?.length || 0); 
                  const grossRevenue = (paidTickets || []).reduce((sum, t) => sum + (t.amount_paid || 0), 0);
                  const netPayout = Math.round(grossRevenue * (1 - EVENT_CONSTANTS.COMMISSION_RATE) * 100) / 100;

                  await ResendEmailService.sendTicketSaleNotificationEmail(
                    organizer.email,
                    organizer.username || 'Event Organizer',
                    fullEvent.title,
                    attendee_name,
                    attendee_email,
                    `${quantity}x ${tier.name}`,
                    0,
                    insertedTickets[0].id,
                    event_id,
                    totalSold,
                    grossRevenue,
                    netPayout
                  );
                } catch (statsErr) {
                  await ResendEmailService.sendTicketSaleNotificationEmail(
                    organizer.email,
                    organizer.username || 'Event Organizer',
                    fullEvent.title,
                    attendee_name,
                    attendee_email,
                    `${quantity}x ${tier.name}`,
                    0,
                    insertedTickets[0].id
                  );
                }
              }
            } catch (orgErr) {}
          }
        }
      } catch (emailErr) {}

      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: user.id,
        event: 'ticket_purchased',
        properties: {
          ticket_id: insertedTickets[0].id,
          event_id,
          tier_id,
          tier_name: tier.name,
          quantity,
          amount: 0,
          is_free: true,
        },
      });

      return NextResponse.json({ success: true, free: true, ticket_id: insertedTickets[0].id, quantity });
    }

    // ── Paid ticket — initialise Paystack payment ─────────────────────────
    const txRef = `evt-${event_id.substring(0, 8)}-${Date.now()}`;
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';
    
    const totalAmount = tier.price * quantity;

    let paymentLink: string;
    try {
      paymentLink = await PaystackService.initializePayment({
        transactionId: txRef,
        amount: totalAmount,
        buyerEmail: attendee_email,
        buyerName: attendee_name,
        itemTitle: `${quantity}x ${tier.name} — ${event.title}`,
        sellerName: 'Event Organizer',
        callbackUrl: callbackUrl || `${origin}/my-tickets?success=1`,
        metadata: {
          event_id,
          tier_id,
          quantity, // IMPORTANT: Pass quantity to webhook
          buyer_id: user.id,
          attendee_name,
          attendee_email,
          attendee_phone: attendee_phone || null
        }
      });
    } catch (paystackError: any) {
      console.error('[v0] Paystack init error:', paystackError);
      return NextResponse.json({
        error: 'Payment initialization failed',
        details: paystackError?.message || 'Paystack API error',
      }, { status: 502 });
    }

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'ticket_purchased_initiated',
      properties: {
        event_id,
        tier_id,
        tier_name: tier.name,
        quantity,
        amount: totalAmount,
        is_free: false,
        tx_ref: txRef,
      },
    });

    return NextResponse.json({ success: true, payment_link: paymentLink, tx_ref: txRef });
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
