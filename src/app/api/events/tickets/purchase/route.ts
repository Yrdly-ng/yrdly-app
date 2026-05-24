import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EVENT_CONSTANTS } from '@/lib/constants';
import { ResendEmailService } from '@/lib/resend-service';
import QRCode from 'qrcode';

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

    // ── Check if user already has a ticket for this event ────────────────────
    const { data: existingTicket } = await supabaseAdmin
      .from('tickets')
      .select('id')
      .eq('buyer_id', user.id)
      .eq('event_id', event_id)
      .eq('status', 'PAID')
      .maybeSingle();

    if (existingTicket) {
      return NextResponse.json({ 
        error: 'ALREADY_PURCHASED',
        message: 'You have already purchased a ticket for this event' 
      }, { status: 400 });
    }

    // ── Free ticket — create directly, no payment needed ────────────────────
    if (tier.price === 0) {
      const ticketCode = `${EVENT_CONSTANTS.TICKET_CODE_PREFIX}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const qrData = JSON.stringify({ ticket_code: ticketCode, event_id, tier_id });
      const qrDataUrl = await QRCode.toDataURL(qrData, { width: 300, margin: 2 });

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

      // Increment event attendee_count
      try {
        const { data: eData } = await supabaseAdmin.from('events').select('attendee_count').eq('id', event_id).single();
        if (eData) {
          await supabaseAdmin.from('events').update({ attendee_count: (eData.attendee_count || 0) + 1 }).eq('id', event_id);
        }
      } catch (e) {}

      // ── Send confirmation email to buyer ────────────────────────────────
      try {
        const resendStatus = ResendEmailService.getConfigurationStatus();
        console.log('[v0] Resend config status for free ticket:', resendStatus);
        
        if (!ResendEmailService.isConfigured()) {
          console.warn('[v0] Resend is not configured. Skipping free ticket emails.');
        } else {
          const { data: fullEvent } = await supabaseAdmin
            .from('events')
            .select('id, title, start_time, location_address, state, organizer_id')
            .eq('id', event_id)
            .single();

          if (fullEvent) {
            const startDate = new Date(fullEvent.start_time);
            console.log('[v0] Sending free ticket confirmation to:', attendee_email);
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
              `FREE-${ticketCode}`
            );
            console.log('[v0] Free ticket confirmation email sent successfully');

            // ── Send organizer notification ─────────────────────────────────
            try {
              const { data: organizer } = await supabaseAdmin
                .from('users')
                .select('email, username')
                .eq('id', fullEvent.organizer_id)
                .single();

              if (organizer?.email) {
                // Calculate event stats for email
                try {
                  const { data: paidTickets } = await supabaseAdmin
                    .from('tickets')
                    .select('amount_paid')
                    .eq('event_id', event_id)
                    .eq('status', 'PAID');

                  const totalSold = (paidTickets?.length || 0) + 1; // +1 for current free ticket
                  const grossRevenue = (paidTickets || []).reduce((sum, t) => sum + (t.amount_paid || 0), 0);
                  const netPayout = Math.round(grossRevenue * (1 - 0.02) * 100) / 100; // 2% commission

                  console.log('[v0] Sending free ticket organizer notification to:', organizer.email);
                  await ResendEmailService.sendTicketSaleNotificationEmail(
                    organizer.email,
                    organizer.username || 'Event Organizer',
                    fullEvent.title,
                    attendee_name,
                    attendee_email,
                    tier.name,
                    0,
                    ticket.id,
                    event_id,
                    totalSold,
                    grossRevenue,
                    netPayout
                  );
                  console.log('[v0] Free ticket organizer notification sent successfully');
                } catch (statsErr) {
                  console.error('[v0] Error calculating free ticket event stats:', statsErr);
                  // Fall back to sending without stats
                  await ResendEmailService.sendTicketSaleNotificationEmail(
                    organizer.email,
                    organizer.username || 'Event Organizer',
                    fullEvent.title,
                    attendee_name,
                    attendee_email,
                    tier.name,
                    0,
                    ticket.id
                  );
                }
              } else {
                console.log('[v0] No organizer email found');
              }
            } catch (orgErr) {
              console.error('[v0] Organizer notification failed (non-critical):', orgErr);
            }
          }
        }
      } catch (emailErr) {
        console.error('[v0] Free ticket email failed (non-critical):', emailErr);
      }

      return NextResponse.json({ success: true, free: true, ticket_id: ticket.id });
    }

    // ── Paid ticket — initialise Flutterwave payment ─────────────────────────
    const txRef = `evt-${event_id.substring(0, 8)}-${Date.now()}`;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://yrdly-app.vercel.app';

    // Build payload
    const flwPayload: any = {
      tx_ref: txRef,
      amount: tier.price,
      currency: 'NGN',
      redirect_url: `${appUrl}/api/events/tickets/verify?tx_ref=${txRef}`,
      payment_options: 'card,banktransfer,ussd,mobilemoney',
      customer: { 
        email: attendee_email, 
        name: attendee_name, 
        phonenumber: attendee_phone || '' 
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
