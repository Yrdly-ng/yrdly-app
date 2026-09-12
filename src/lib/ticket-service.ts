import { supabaseAdmin } from '@/lib/supabase-admin';
import { ResendEmailService } from '@/lib/resend-service';
import QRCode from 'qrcode';
import { EVENT_CONSTANTS } from '@/lib/constants';
import { PaystackService } from '@/lib/paystack-service';
import { PaylukService } from '@/lib/payluk-service';

export class TicketService {
  /**
   * Processes a ticket purchase from a confirmed escrow_transaction (e.g. via Payluk Webhook or manual verification)
   */
  static async processTicketPaymentFromTransaction(tx: any) {
    const txRef = tx.id || tx.payluk_tx_ref;
    const metadata = tx.metadata || {};
    const event_id = tx.event_id || metadata.event_id;
    const tier_id = tx.item_id || metadata.tier_id;
    const buyer_id = tx.buyer_id || metadata.buyer_id;
    const attendee_name = metadata.attendee_name;
    const attendee_email = metadata.attendee_email;
    const attendee_phone = metadata.attendee_phone || null;
    const quantity = Math.max(1, parseInt(metadata.quantity || '1', 10));
    const amount = Number(tx.amount) || 0;

    if (!event_id || !tier_id || !buyer_id) {
      console.error('[TicketService] Missing required metadata in transaction:', tx);
      throw new Error('invalid_metadata');
    }

    // ── Idempotency check ────────────────────────────────────────────────────
    const { data: existing } = await supabaseAdmin
      .from('tickets')
      .select('id, event_id, ticket_code, qr_data')
      .or(`payment_tx_ref.eq.${txRef},payment_tx_ref.eq.${tx.id}`);

    if (existing && existing.length > 0) {
      return { ...existing[0], event_id, quantity };
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

    // ── Generate ticket codes & QR ────────────────────────────────────────────
    const ticketsToInsert = [];
    for (let i = 0; i < quantity; i++) {
      const ticketCode = `${EVENT_CONSTANTS.TICKET_CODE_PREFIX}-${txRef.substring(txRef.length - 8).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const qrPayload = JSON.stringify({ ticket_code: ticketCode, event_id, tier_id, tx_ref: txRef });
      
      ticketsToInsert.push({
        buyer_id,
        event_id,
        tier_id,
        attendee_name: attendee_name || 'Attendee',
        attendee_email: attendee_email || '',
        attendee_phone: attendee_phone || null,
        ticket_code: ticketCode,
        qr_data: qrPayload,
        status: 'PAID',
        payment_tx_ref: txRef,
        payment_provider_ref: tx.payluk_escrow_id || tx.payluk_tx_ref || txRef,
        amount_paid: amount / quantity,
        expires_at: event.end_time || null,
      });
    }

    // ── Insert tickets ────────────────────────────────────────────────────────
    const { data: insertedTickets, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .insert(ticketsToInsert)
      .select('id, ticket_code, qr_data');

    if (ticketError) throw ticketError;

    // ── Increment sold count atomically ──────────────────────────────────────
    await supabaseAdmin
      .from('ticket_tiers')
      .update({ sold: (tier.sold || 0) + quantity })
      .eq('id', tier_id);

    try {
      const { data: eData } = await supabaseAdmin.from('events').select('attendee_count').eq('id', event_id).single();
      if (eData) {
        await supabaseAdmin.from('events').update({ attendee_count: (eData.attendee_count || 0) + quantity }).eq('id', event_id);
      }
    } catch (e) { }

    // ── Send ticket confirmation email to buyer ────────────────────────────
    try {
      if (ResendEmailService.isConfigured() && attendee_email) {
        const startDate = new Date(event.start_time);
        
        for (const ticket of insertedTickets) {
          const qrDataUrl = await QRCode.toDataURL(ticket.qr_data, { width: 300, margin: 2 });
          await ResendEmailService.sendTicketConfirmationEmail(
            attendee_name || 'Attendee', attendee_email, event.title, tier.name,
            ticket.id, qrDataUrl,
            startDate.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            startDate.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            event.location_address || event.state || 'See event details',
            ticket.ticket_code
          );
        }
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
          const grossRevenue = (paidTickets || []).reduce((sum, t) => sum + (t.amount_paid || 0), 0);
          const netPayout = Math.round(grossRevenue * (1 - EVENT_CONSTANTS.COMMISSION_RATE) * 100) / 100;

          await ResendEmailService.sendTicketSaleNotificationEmail(
            organizer.email,
            organizer.username || 'Event Organizer',
            event.title,
            attendee_name || 'Attendee',
            attendee_email || '',
            tier.name,
            amount,
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
            event.title,
            attendee_name || 'Attendee',
            attendee_email || '',
            tier.name,
            amount,
            insertedTickets[0].id
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
        type: 'ticket_confirmed',
        title: `🎟️ Ticket Confirmed!`,
        message: `Your ${quantity}x ${tier.name} ticket(s) for "${event.title}" is ready. Check My Tickets.`,
        related_id: insertedTickets[0].id,
        related_type: 'ticket',
        data: { ticket_id: insertedTickets[0].id, event_id, ticket_code: insertedTickets[0].ticket_code },
      });
    } catch (e) {
      // Ignore
    }

    return { ...insertedTickets[0], event_id, quantity };
  }

  static async verifyAndProcessTicket(txRef: string) {
    // 1. First check if txRef is a Payluk escrow transaction in local DB
    const { data: paylukTx } = await supabaseAdmin
      .from('escrow_transactions')
      .select('*')
      .or(`id.eq.${txRef},payluk_tx_ref.eq.${txRef},payluk_escrow_id.eq.${txRef}`)
      .maybeSingle();

    if (paylukTx) {
      // Verify directly with Payluk API
      if (paylukTx.payluk_tx_ref || paylukTx.payluk_escrow_id) {
        try {
          const escrowToken = paylukTx.payluk_tx_ref || txRef;
          const paylukEscrow = await PaylukService.verifyEscrow(escrowToken);
          const statusLower = (paylukEscrow.status || paylukEscrow.state || '').toLowerCase();
          
          if (
            statusLower === 'ongoing' ||
            statusLower === 'paid' ||
            statusLower === 'completed' ||
            statusLower === 'opened' ||
            paylukTx.status === 'PAID'
          ) {
            // Update transaction to PAID if pending
            if (paylukTx.status !== 'PAID') {
              await supabaseAdmin
                .from('escrow_transactions')
                .update({ status: 'PAID', paid_at: new Date().toISOString() })
                .eq('id', paylukTx.id);
              paylukTx.status = 'PAID';
            }
            return await TicketService.processTicketPaymentFromTransaction(paylukTx);
          }
        } catch (paylukVerifyErr) {
          console.warn('[TicketService] Payluk verifyEscrow error:', paylukVerifyErr);
          if (paylukTx.status === 'PAID') {
            return await TicketService.processTicketPaymentFromTransaction(paylukTx);
          }
        }
      }
    }

    // 2. Fallback to Paystack verification for legacy transactions
    const verification = await PaystackService.verifyPayment(txRef);

    if (!verification.success || verification.status !== 'success') {
      throw new Error('payment_failed');
    }

    const { transactionReference, metadata } = verification;
    const amount = verification.amount || 0;
    const { event_id, tier_id, buyer_id, attendee_name, attendee_email, attendee_phone, quantity: rawQuantity } = metadata || {};
    const quantity = Math.max(1, parseInt(rawQuantity || '1', 10));

    if (!event_id || !tier_id || !buyer_id) {
      console.error('[TicketService] Missing metadata in Paystack response', metadata);
      throw new Error('invalid_metadata');
    }

    // ── Idempotency check ───────────────────────────────────────────────────
    const { data: existing } = await supabaseAdmin
      .from('tickets')
      .select('id, event_id')
      .eq('payment_tx_ref', txRef);

    if (existing && existing.length > 0) {
      return existing[0];
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
    if (tier.capacity !== null && (tier.sold || 0) + quantity > tier.capacity) {
      console.warn(`[TicketService] Tier ${tier_id} is sold out. Refunding transaction ${txRef}`);
      try {
        await PaystackService.refundTransaction(txRef, amount);
      } catch (e) {
        console.error('[TicketService] Failed to refund oversold ticket', e);
      }
      throw new Error('sold_out_refunded');
    }

    // ── Generate ticket codes & QR ────────────────────────────────────────────
    const ticketsToInsert = [];
    for (let i = 0; i < quantity; i++) {
      const ticketCode = `${EVENT_CONSTANTS.TICKET_CODE_PREFIX}-${txRef.substring(txRef.length - 8).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const qrPayload = JSON.stringify({ ticket_code: ticketCode, event_id, tier_id, tx_ref: txRef });
      
      ticketsToInsert.push({
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
        amount_paid: amount / quantity,
        expires_at: event.end_time || null,
      });
    }

    // ── Insert tickets ────────────────────────────────────────────────────────
    const { data: insertedTickets, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .insert(ticketsToInsert)
      .select('id, ticket_code, qr_data');

    if (ticketError) throw ticketError;

    // ── Increment sold count ─────────────────────────────────────────────────
    await supabaseAdmin
      .from('ticket_tiers')
      .update({ sold: (tier.sold || 0) + quantity })
      .eq('id', tier_id);

    try {
      const { data: eData } = await supabaseAdmin.from('events').select('attendee_count').eq('id', event_id).single();
      if (eData) {
        await supabaseAdmin.from('events').update({ attendee_count: (eData.attendee_count || 0) + quantity }).eq('id', event_id);
      }
    } catch (e) { }

    return { ...insertedTickets[0], event_id, quantity };
  }
}

