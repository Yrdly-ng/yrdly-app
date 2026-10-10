import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ResendEmailService } from '@/lib/resend-service';
import QRCode from 'qrcode';
import { EVENT_CONSTANTS } from '@/lib/constants';
import { PaylukService } from '@/lib/payluk-service';
import { sendPushNotification } from '@/lib/server-push-notification';
import { paymentReferenceFilter } from './payment-state';
import { flagPayment } from './payment-reconciliation';

export class TicketService {
  /**
   * Processes a ticket purchase from a confirmed escrow_transaction (e.g. via Payluk Webhook or manual verification)
   */
  static async processTicketPaymentFromTransaction(tx: any) {
    if (tx.payment_provider !== 'payluk') throw new Error('payment_requires_review');
    const txRef = tx.id || tx.payluk_tx_ref;
    const metadata = tx.metadata || {};
    const event_id = tx.event_id || metadata.event_id;
    const tier_id = tx.item_id || metadata.tier_id;
    const buyer_id = tx.buyer_id || metadata.buyer_id;
    const attendee_name = metadata.attendee_name;
    const attendee_email = metadata.attendee_email;
    const attendee_phone = metadata.attendee_phone || null;
    const quantity = Number(metadata.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('invalid_quantity');
    const amount = Number(tx.amount) || 0;

    if (!event_id || !tier_id || !buyer_id) {
      console.error('[TicketService] Missing required transaction metadata', { id: tx.id });
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

    if (tier.capacity !== null && (tier.sold || 0) + quantity > tier.capacity) {
      throw new Error('sold_out_payluk_refund_required');
    }

    // ── Generate ticket codes & QR ────────────────────────────────────────────
    const ticketsToInsert = [];
    for (let i = 0; i < quantity; i++) {
      const ticketCode = `${EVENT_CONSTANTS.TICKET_CODE_PREFIX}-${txRef.substring(txRef.length - 8).toUpperCase()}-${randomBytes(12).toString('hex').toUpperCase()}`;
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
        purchase_ticket_index: i,
        payment_provider: 'payluk', settlement_mode: 'held',
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

    if (ticketError?.code === '23505') {
      const { data: duplicateTickets, error: duplicateLookupError } = await supabaseAdmin
        .from('tickets')
        .select('id, event_id, ticket_code, qr_data')
        .or(`payment_tx_ref.eq.${txRef},payment_tx_ref.eq.${tx.id}`);
      if (duplicateLookupError) throw duplicateLookupError;
      if (duplicateTickets?.length) return { ...duplicateTickets[0], event_id, quantity };
    }
    if (ticketError?.message?.includes('ticket_tier_sold_out')) {
      throw new Error('sold_out_payluk_refund_required');
    }
    if (ticketError) throw ticketError;

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
      const notification = {
        user_id: buyer_id,
        type: 'ticket_confirmed',
        title: `🎟️ Ticket Confirmed!`,
        message: `Your ${quantity}x ${tier.name} ticket(s) for "${event.title}" is ready. Check My Tickets.`,
        related_id: insertedTickets[0].id,
        related_type: 'ticket',
        data: { ticket_id: insertedTickets[0].id, event_id, ticket_code: insertedTickets[0].ticket_code },
      };
      const { error } = await supabaseAdmin.from('notifications').insert(notification);
      if (error) throw error;
      await sendPushNotification(supabaseAdmin, buyer_id, {
        title: notification.title,
        body: notification.message,
        data: notification.data,
        url: '/my-tickets',
      }, notification.type);
    } catch (e) {
      // Ignore
    }

    return { ...insertedTickets[0], event_id, quantity };
  }

  static async verifyAndProcessTicket(txRef: string, expectedBuyerId?: string) {
    const { data: paylukTx, error: lookupError } = await supabaseAdmin
      .from('escrow_transactions').select('*')
      .or(paymentReferenceFilter(txRef, ['id', 'payment_reference', 'payluk_tx_ref', 'payluk_escrow_id']))
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (paylukTx) {
      if (expectedBuyerId && paylukTx.buyer_id !== expectedBuyerId) throw new Error('ticket_buyer_mismatch');
      if (paylukTx.payment_provider !== 'payluk') throw new Error('payment_requires_review');
      if (paylukTx.item_type !== 'ticket') throw new Error('invalid_metadata');
      if (['cancelled', 'disputed'].includes(paylukTx.status)) throw new Error('payment_requires_review');
      if (['paid', 'shipped', 'delivered', 'completed'].includes(paylukTx.status)) {
        return TicketService.processTicketPaymentFromTransaction(paylukTx);
      }
      const token = paylukTx.payluk_tx_ref;
      if (!token) throw new Error('payment_pending');
      const escrow = await PaylukService.verifyEscrow(token);
      if (!['ONGOING', 'COMPLETED', 'CLAIMED'].includes((escrow.status || '').toUpperCase())) throw new Error('payment_pending');
      if (Math.round(Number(escrow.amount) * 100) !== Math.round(Number(paylukTx.amount) * 100)) {
        await flagPayment('payluk', token, paylukTx.id, 'amount_mismatch');
        throw new Error('payment_requires_review');
      }
      const { data: paid, error } = await supabaseAdmin.from('escrow_transactions')
        .update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', paylukTx.id)
        .in('status', ['pending', 'creating_escrow', 'reconciling']).select('*').maybeSingle();
      if (error) throw error;
      if (!paid) throw new Error('payment_requires_review');
      return TicketService.processTicketPaymentFromTransaction(paid);
    }

    throw new Error('payment_not_found');
  }
}
