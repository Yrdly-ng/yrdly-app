import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase/supabase-server";
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { EVENT_CONSTANTS } from '@/lib/shared/constants';
import { isMoneyAmount, isPaidPrice, MINIMUM_PRICE_MESSAGE } from '@/lib/marketplace/price-policy';
import { ResendEmailService } from '@/lib/email/resend-service';
import QRCode from 'qrcode';
import { createTicketCheckout, TicketCheckoutError } from '@/lib/events/ticket-checkout';
import { sendPushNotification } from '@/lib/notifications/server-push-notification';

/**
 * POST /api/events/tickets/purchase
 * Initialises a Payluk Escrow payment for a ticket.
 * Returns paylukPaymentToken & payment_link.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });
    }

    const { isUserSuspendedOrBanned } = await import('@/lib/moderation/user-suspension');
    const { suspended: buyerSuspended } = await isUserSuspendedOrBanned(user.id);
    if (buyerSuspended) {
      return NextResponse.json(
        { error: 'Your account is suspended or banned. You cannot perform transactions.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    const { event_id, tier_id, attendee_name, attendee_email, attendee_phone, quantity: rawQuantity } = body;
    const quantity = rawQuantity === undefined ? 1
      : typeof rawQuantity === 'string' && /^\d+$/.test(rawQuantity) ? Number(rawQuantity) : rawQuantity;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof event_id !== 'string' || !uuid.test(event_id) || typeof tier_id !== 'string' || !uuid.test(tier_id) ||
        typeof attendee_name !== 'string' || !attendee_name.trim() || attendee_name.length > 120 ||
        typeof attendee_email !== 'string' || attendee_email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendee_email) ||
        (attendee_phone != null && (typeof attendee_phone !== 'string' || attendee_phone.length > 30)) ||
        !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5) {
      return NextResponse.json({ error: 'Provide valid attendee details and an integer quantity between 1 and 5' }, { status: 400 });
    }

    // ── Validate event & tier ────────────────────────────────────────────────
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, title, status, organizer_id, end_time')
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
    const tierPrice = Number(tier.price);
    if (!isMoneyAmount(tierPrice) || (tierPrice > 0 && !isPaidPrice(tierPrice))) {
      return NextResponse.json({ error: MINIMUM_PRICE_MESSAGE }, { status: 400 });
    }
    if (!tier.is_visible) return NextResponse.json({ error: 'This ticket tier is not available' }, { status: 400 });
    if (tier.sale_ends_at && new Date(tier.sale_ends_at) < new Date()) {
      return NextResponse.json({ error: 'Ticket sales have ended for this tier' }, { status: 400 });
    }

    const MAX_TICKETS_PER_TIER = 5;
    if (quantity > MAX_TICKETS_PER_TIER) {
      return NextResponse.json({ error: `You can only purchase a maximum of ${MAX_TICKETS_PER_TIER} tickets per tier.` }, { status: 400 });
    }

    const { data: existingUserTickets } = await supabaseAdmin
      .from('tickets')
      .select('id')
      .eq('buyer_id', user.id)
      .eq('tier_id', tier_id)
      .in('status', ['PAID', 'USED']);

    const userOwnedCount = existingUserTickets?.length || 0;
    if (userOwnedCount + quantity > MAX_TICKETS_PER_TIER) {
      const remainingAllowed = Math.max(0, MAX_TICKETS_PER_TIER - userOwnedCount);
      const message = userOwnedCount >= MAX_TICKETS_PER_TIER
        ? `You have reached the maximum limit of ${MAX_TICKETS_PER_TIER} tickets for this tier.`
        : `You already own ${userOwnedCount} ticket(s) for this tier. You can only buy up to ${remainingAllowed} more (max ${MAX_TICKETS_PER_TIER} per tier).`;
      return NextResponse.json({ error: 'MAX_TICKET_LIMIT_EXCEEDED', message }, { status: 400 });
    }

    if (tier.price === 0 && tier.capacity !== null && (tier.sold + quantity) > tier.capacity) {
      return NextResponse.json({ error: 'SOLD_OUT', message: `Not enough tickets left. Only ${Math.max(0, tier.capacity - tier.sold)} available.` }, { status: 409 });
    }

    // ── Free ticket — create directly, no payment needed ────────────────────
    if (tier.price === 0) {
      const ticketsToInsert = [];
      
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
          payment_provider: null, settlement_mode: 'free',
          expires_at: event.end_time || null,
        });
      }

      const { data: insertedTickets, error: ticketError } = await supabaseAdmin
        .from('tickets')
        .insert(ticketsToInsert)
        .select('id, ticket_code, qr_data');

      if (ticketError?.message?.includes('ticket_tier_sold_out')) {
        return NextResponse.json({ error: 'SOLD_OUT', message: 'This ticket tier just sold out.' }, { status: 409 });
      }
      if (ticketError) throw ticketError;

      // Increment event attendee_count
      try {
        const { data: eData } = await supabaseAdmin.from('events').select('attendee_count').eq('id', event_id).single();
        if (eData) {
          await supabaseAdmin.from('events').update({ attendee_count: (eData.attendee_count || 0) + quantity }).eq('id', event_id);
        }
      } catch (e) {}

      // ── Send confirmation email to buyer ────────────────────────────────
      try {
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

      try {
        const notification = {
          title: '🎟️ Ticket Confirmed!',
          message: `Your ${quantity}x ${tier.name} ticket(s) for "${event.title}" are ready. Check My Tickets.`,
          data: {
            ticket_id: insertedTickets[0].id,
            event_id,
            ticket_code: insertedTickets[0].ticket_code,
          },
        };
        const { data: result, error: notificationError } = await supabaseAdmin.rpc('create_notification', {
          p_user_id: user.id,
          p_type: 'ticket_confirmed',
          p_title: notification.title,
          p_message: notification.message,
          p_sender_id: null,
          p_related_id: insertedTickets[0].id,
          p_related_type: 'ticket',
          p_data: notification.data,
        });
        if (notificationError) throw notificationError;
        if ((result as { should_push?: boolean } | null)?.should_push !== false) {
          await sendPushNotification(supabaseAdmin, user.id, {
            title: notification.title,
            body: notification.message,
            data: notification.data,
            url: '/my-tickets',
          }, 'ticket_confirmed');
        }
      } catch (notificationError) {
        console.error('[Tickets] Could not send free-ticket confirmation notification:', notificationError);
      }

      return NextResponse.json({ success: true, free: true, ticket_id: insertedTickets[0].id, quantity });
    }

    const { data: permitted, error: rateError } = await supabaseAdmin.rpc('consume_rate_limit', {
      p_user_id: user.id, p_endpoint: '/api/events/tickets/purchase', p_max_requests: 10, p_window_seconds: 60,
    });
    if (rateError) return NextResponse.json({ error: 'Unable to authorize checkout' }, { status: 503 });
    if (!permitted) return NextResponse.json({ error: 'Too many checkout requests' }, { status: 429 });
    const result = await createTicketCheckout({
      event_id, tier_id, buyer_id: user.id, quantity,
      attendee_name: attendee_name.trim(), attendee_email: attendee_email.trim(), attendee_phone: attendee_phone || null,
    }, `${quantity}x ${tier.name} — ${event.title}`, event.end_time);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TicketCheckoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[TicketPurchase] Ticket purchase error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
