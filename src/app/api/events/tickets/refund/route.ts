import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isPaylukTicket } from '@/lib/ticket-payment-provider';
import { requestPaystackTicketRefund } from '@/lib/ticket-refunds';
import { sendPushNotification } from '@/lib/server-push-notification';

/**
 * POST /api/events/tickets/refund
 * Allows the event organizer to refund a specific ticket.
 * Body: { ticket_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const { ticket_id } = await request.json();
    if (!ticket_id) return NextResponse.json({ error: 'ticket_id is required' }, { status: 400 });

    // ── Fetch ticket & verify organizer ──────────────────────────────────────
    const { data: ticket } = await supabaseAdmin
      .from('tickets')
      .select(`
        id, status, refund_status, payment_provider_ref, payment_tx_ref, amount_paid, buyer_id,
        attendee_name, attendee_email,
        event:events!tickets_event_id_fkey(id, title, organizer_id, payout_released_at)
      `)
      .eq('id', ticket_id)
      .single();

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const event = ticket.event as any;
    if (event.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Only the event organizer can issue refunds' }, { status: 403 });
    }

    const { data: payout, error: payoutError } = await supabaseAdmin
      .from('event_payouts')
      .select('id, status')
      .eq('event_id', event.id)
      .in('status', ['PENDING', 'PROCESSING', 'COMPLETED'])
      .limit(1)
      .maybeSingle();
    if (payoutError) throw payoutError;
    if (event.payout_released_at || payout) {
      return NextResponse.json(
        { error: 'This event payout has started or completed. Contact support to resolve the refund safely.' },
        { status: 409 }
      );
    }

    if (ticket.status !== 'PAID') {
      return NextResponse.json({ error: `Ticket status is "${ticket.status}" — cannot refund` }, { status: 400 });
    }
    if (ticket.refund_status) {
      return NextResponse.json({ error: `This ticket's refund is ${ticket.refund_status}; contact support if it needs attention.` }, { status: 409 });
    }

    if (await isPaylukTicket(ticket.payment_tx_ref)) {
      return NextResponse.json({ error: 'This Payluk escrow requires a dispute or support-assisted refund. The ticket remains valid until that refund is confirmed.' }, { status: 409 });
    }
    if (ticket.amount_paid > 0 && !ticket.payment_provider_ref) {
      return NextResponse.json({ error: 'Payment reference missing; contact support before changing the ticket.' }, { status: 409 });
    }

    // Paystack refunds are asynchronous. Keep the ticket active in the ledger
    // until refund.processed arrives, while check-in blocks pending refunds.
    if (ticket.payment_provider_ref && ticket.amount_paid > 0) {
      const { data: orderTickets, error: orderError } = await supabaseAdmin.from('tickets')
        .select('id').eq('payment_provider_ref', ticket.payment_provider_ref);
      if (orderError) throw orderError;
      if ((orderTickets?.length || 0) > 1) {
        return NextResponse.json({ error: 'This ticket belongs to a multi-ticket payment. Contact support to refund the order together.' }, { status: 409 });
      }
      try {
        await requestPaystackTicketRefund(ticket.payment_provider_ref, [{ id: ticket.id, amount_paid: ticket.amount_paid }]);
      } catch (error) {
        console.error('Ticket refund request needs attention:', error);
        return NextResponse.json({ error: 'Refund state needs support review before any retry.' }, { status: 502 });
      }
    } else {
      const { error: updateError } = await supabaseAdmin.from('tickets')
        .update({ status: 'REFUNDED', refund_status: 'processed', updated_at: new Date().toISOString() })
        .eq('id', ticket_id).eq('status', 'PAID');
      if (updateError) throw updateError;
    }

    // ── Notify buyer ─────────────────────────────────────────────────────────
    try {
      const notification = {
        user_id: ticket.buyer_id,
        type: 'event_cancelled',
        title: '💰 Refund Requested',
        message: `A refund of ₦${Number(ticket.amount_paid).toLocaleString()} was requested for your ticket to "${event.title}". Check your payment method for the final credit.`,
        related_id: event.id,
        related_type: 'event',
        data: { ticket_id, event_id: event.id, amount: ticket.amount_paid },
      };
      const { error: notificationError } = await supabaseAdmin.from('notifications').insert(notification);
      if (notificationError) throw notificationError;
      await sendPushNotification(supabaseAdmin, ticket.buyer_id, {
        title: notification.title,
        body: notification.message,
        data: notification.data,
        url: `/events/${event.id}`,
      }, notification.type);
    } catch (e) {
      console.error('Failed to send refund notification:', e);
    }

    return NextResponse.json({ success: true, message: 'Refund requested successfully' });
  } catch (error) {
    console.error('Ticket refund error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
