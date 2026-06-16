import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ResendEmailService } from '@/lib/resend-service';
import { emailTemplates } from '@/lib/email-templates';
import QRCode from 'qrcode';
import { EVENT_CONSTANTS } from '@/lib/constants';
import { PaystackService } from '@/lib/paystack-service';

/**
 * GET /api/events/tickets/verify?tx_ref=...
 * Paystack redirects here after payment.
 * Verifies the transaction, creates the ticket, generates QR, fires confirmation email.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const txRef = searchParams.get('tx_ref');
  const status = searchParams.get('status');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.yrdly.ng';

  if (!txRef) {
    return NextResponse.redirect(`${appUrl}/events?error=invalid_ref`);
  }

  // Payment was cancelled by user
  if (status === 'cancelled') {
    return NextResponse.redirect(`${appUrl}/events?error=payment_cancelled`);
  }

  try {
    // ── Verify with Paystack ──────────────────────────────────────────
    const verification = await PaystackService.verifyPayment(txRef);

    if (!verification.success || verification.status !== 'success') {
      return NextResponse.redirect(`${appUrl}/events?error=payment_failed`);
    }

    const { transactionReference, metadata } = verification;
    const amount = verification.amount || 0;
    const { event_id, tier_id, buyer_id, attendee_name, attendee_email, attendee_phone } = metadata || {};

    if (!event_id || !tier_id || !buyer_id) {
      console.error('[Verify] Missing metadata in Paystack response', metadata);
      return NextResponse.redirect(`${appUrl}/events?error=invalid_metadata`);
    }

    // ── Idempotency check — don't create duplicate tickets ───────────────────
    const { data: existing } = await supabaseAdmin
      .from('tickets')
      .select('id')
      .eq('payment_tx_ref', txRef)
      .single();

    if (existing) {
      return NextResponse.redirect(`${appUrl}/my-tickets?success=1&ticket_id=${existing.id}`);
    }

    // ── Fetch tier & event ───────────────────────────────────────────────────
    const { data: tier } = await supabaseAdmin
      .from('ticket_tiers')
      .select('id, name, price, sold, capacity')
      .eq('id', tier_id)
      .single();

    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, title, start_time, end_time, location_address, organizer_id, state')
      .eq('id', event_id)
      .single();

    if (!tier || !event) {
      return NextResponse.redirect(`${appUrl}/events?error=event_not_found`);
    }

    // ── Check Capacity ───────────────────────────────────────────────────────
    if (tier.capacity !== null && (tier.sold || 0) >= tier.capacity) {
      console.warn(`[Verify] Tier ${tier_id} is sold out. Refunding transaction ${txRef}`);
      try {
        await PaystackService.refundTransaction(txRef, amount);
      } catch (e) {
        console.error('[Verify] Failed to refund oversold ticket', e);
      }
      return NextResponse.redirect(`${appUrl}/events/${event_id}?error=sold_out_refunded`);
    }

    // ── Generate ticket code & QR ────────────────────────────────────────────
    const ticketCode = `${EVENT_CONSTANTS.TICKET_CODE_PREFIX}-${txRef.substring(txRef.length - 8).toUpperCase()}`;
    const qrPayload = JSON.stringify({ ticket_code: ticketCode, event_id, tier_id, tx_ref: txRef });
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 300, margin: 2 });

    // ── Insert ticket ────────────────────────────────────────────────────────
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .insert({
        buyer_id,
        event_id,
        tier_id,
        attendee_name,
        attendee_email,
        attendee_phone: attendee_phone || null,
        ticket_code: ticketCode,
        qr_data: qrPayload,
        status: 'PAID',
        payment_tx_ref: txRef,
        payment_provider_ref: transactionReference || txRef,
        amount_paid: amount,
      })
      .select('id')
      .single();

    if (ticketError) throw ticketError;

    // ── Increment sold count atomically ──────────────────────────────────────
    await supabaseAdmin
      .from('ticket_tiers')
      .update({ sold: (tier.sold || 0) + 1 })
      .eq('id', tier_id);

    // Increment event attendee_count
    try {
      const { data: eData } = await supabaseAdmin.from('events').select('attendee_count').eq('id', event_id).single();
      if (eData) {
        await supabaseAdmin.from('events').update({ attendee_count: (eData.attendee_count || 0) + 1 }).eq('id', event_id);
      }
    } catch (e) { }

    // ── Send ticket confirmation email to buyer ────────────────────────────
    try {
      const resendStatus = ResendEmailService.getConfigurationStatus();
      console.log('[v0] Resend config status:', resendStatus);

      if (!ResendEmailService.isConfigured()) {
        console.warn('[v0] Resend is not configured. Skipping buyer email.');
      } else {
        const startDate = new Date(event.start_time);
        const { subject, html } = emailTemplates.ticketConfirmation(
          attendee_name,
          attendee_email,
          event.title,
          tier.name,
          ticket.id,
          qrDataUrl,
          startDate.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
          startDate.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
          event.location_address || event.state || 'See event details',
          txRef
        );

        console.log('[v0] Sending ticket confirmation to:', attendee_email);
        await ResendEmailService.sendTicketConfirmationEmail(
          attendee_name, attendee_email, event.title, tier.name,
          ticket.id, qrDataUrl,
          startDate.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
          startDate.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
          event.location_address || event.state || 'See event details',
          txRef
        );
        console.log('[v0] Ticket confirmation email sent successfully');
      }
    } catch (emailErr) {
      console.error('[v0] Ticket email to buyer failed (non-critical):', emailErr);
    }

    // ── Send organizer notification email ────────────────────────────────────
    try {
      const { data: organizer } = await supabaseAdmin
        .from('users')
        .select('email, username')
        .eq('id', event.organizer_id)
        .single();

      if (organizer?.email) {
        const resendStatus = ResendEmailService.getConfigurationStatus();
        if (!ResendEmailService.isConfigured()) {
          console.warn('[v0] Resend is not configured. Skipping organizer email.');
        } else {
          // Calculate event stats for email
          try {
            const { data: paidTickets } = await supabaseAdmin
              .from('tickets')
              .select('amount_paid')
              .eq('event_id', event_id)
              .eq('status', 'PAID');

            const totalSold = (paidTickets?.length || 0);
            const grossRevenue = (paidTickets || []).reduce((sum, t) => sum + (t.amount_paid || 0), 0) + amount;
            const netPayout = Math.round(grossRevenue * (1 - EVENT_CONSTANTS.COMMISSION_RATE) * 100) / 100;

            console.log('[v0] Sending organizer notification to:', organizer.email);
            await ResendEmailService.sendTicketSaleNotificationEmail(
              organizer.email,
              organizer.username || 'Event Organizer',
              event.title,
              attendee_name,
              attendee_email,
              tier.name,
              amount,
              ticket.id,
              event_id,
              totalSold,
              grossRevenue,
              netPayout
            );
            console.log('[v0] Organizer notification email sent successfully');
          } catch (statsErr) {
            console.error('[v0] Error calculating event stats for email:', statsErr);
            // Fall back to sending without stats
            await ResendEmailService.sendTicketSaleNotificationEmail(
              organizer.email,
              organizer.username || 'Event Organizer',
              event.title,
              attendee_name,
              attendee_email,
              tier.name,
              amount,
              ticket.id
            );
          }
        }
      } else {
        console.log('[v0] No organizer email found for event organizer:', event.organizer_id);
      }
    } catch (emailErr) {
      console.error('[v0] Organizer notification email failed (non-critical):', emailErr);
    }

    // ── In-app notification ──────────────────────────────────────────────────
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: buyer_id,
        type: 'event_reminder',
        title: `🎟️ Ticket Confirmed!`,
        message: `Your ${tier.name} ticket for "${event.title}" is ready. Check My Tickets.`,
        related_id: event_id,
        related_type: 'event',
        data: { ticket_id: ticket.id, event_id, ticket_code: ticketCode },
      });
    } catch (e) {
      // Ignore notification failures
    }

    return NextResponse.redirect(`${appUrl}/my-tickets?success=1&ticket_id=${ticket.id}`);
  } catch (error) {
    console.error('Ticket verify error:', error);
    return NextResponse.redirect(`${appUrl}/events?error=verification_failed`);
  }
}
