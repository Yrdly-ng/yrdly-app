import { supabaseAdmin } from '@/lib/supabase-admin';
import { ResendEmailService } from '@/lib/resend-service';
import QRCode from 'qrcode';
import { EVENT_CONSTANTS } from '@/lib/constants';
import { PaystackService } from '@/lib/paystack-service';

export class TicketService {
  static async verifyAndProcessTicket(txRef: string) {
    // ── Verify with Paystack ──────────────────────────────────────────
    const verification = await PaystackService.verifyPayment(txRef);

    if (!verification.success || verification.status !== 'success') {
      throw new Error('payment_failed');
    }

    const { transactionReference, metadata } = verification;
    const amount = verification.amount || 0;
    const { event_id, tier_id, buyer_id, attendee_name, attendee_email, attendee_phone } = metadata || {};

    if (!event_id || !tier_id || !buyer_id) {
      console.error('[TicketService] Missing metadata in Paystack response', metadata);
      throw new Error('invalid_metadata');
    }

    // ── Idempotency check — don't create duplicate tickets ───────────────────
    const { data: existing } = await supabaseAdmin
      .from('tickets')
      .select('id, event_id')
      .eq('payment_tx_ref', txRef)
      .single();

    if (existing) {
      return existing; // Return the existing ticket
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
      throw new Error('event_not_found');
    }

    // ── Check Capacity ───────────────────────────────────────────────────────
    if (tier.capacity !== null && (tier.sold || 0) >= tier.capacity) {
      console.warn(`[TicketService] Tier ${tier_id} is sold out. Refunding transaction ${txRef}`);
      try {
        await PaystackService.refundTransaction(txRef, amount);
      } catch (e) {
        console.error('[TicketService] Failed to refund oversold ticket', e);
      }
      throw new Error('sold_out_refunded');
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
        expires_at: event.end_time || null,
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
      if (ResendEmailService.isConfigured()) {
        const startDate = new Date(event.start_time);
        await ResendEmailService.sendTicketConfirmationEmail(
          attendee_name, attendee_email, event.title, tier.name,
          ticket.id, qrDataUrl,
          startDate.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
          startDate.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
          event.location_address || event.state || 'See event details',
          txRef
        );
      }
    } catch (emailErr) {
      console.error('[TicketService] Ticket email to buyer failed:', emailErr);
    }

    // ── Send organizer notification email ────────────────────────────────────
    try {
      const { data: organizer } = await supabaseAdmin
        .from('users')
        .select('email, username')
        .eq('id', event.organizer_id)
        .single();

      if (organizer?.email && ResendEmailService.isConfigured()) {
        try {
          const { data: paidTickets } = await supabaseAdmin
            .from('tickets')
            .select('amount_paid')
            .eq('event_id', event_id)
            .eq('status', 'PAID');

          const totalSold = (paidTickets?.length || 0);
          const grossRevenue = (paidTickets || []).reduce((sum, t) => sum + (t.amount_paid || 0), 0) + amount;
          const netPayout = Math.round(grossRevenue * (1 - EVENT_CONSTANTS.COMMISSION_RATE) * 100) / 100;

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
        } catch (statsErr) {
          // Fallback
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
    } catch (emailErr) {
      console.error('[TicketService] Organizer notification email failed:', emailErr);
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
      // Ignore
    }

    return { ...ticket, event_id };
  }
}
