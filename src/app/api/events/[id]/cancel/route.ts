import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getPostHogClient } from '@/lib/posthog-server';
import { isPaylukTicket } from '@/lib/ticket-payment-provider';
import { requestPaystackTicketRefund } from '@/lib/ticket-refunds';

/**
 * POST /api/events/[id]/cancel
 * Cancels the event, triggers Paystack refunds for all PAID tickets,
 * updates statuses, and notifies all buyers via in-app notification.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    // Verify ownership
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, organizer_id, title, status')
      .eq('id', id)
      .single();

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.organizer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (event.status === 'CANCELLED') return NextResponse.json({ success: true, message: 'Already cancelled' });

    // Fetch all PAID tickets for this event
    const { data: paidTickets, error: ticketsError } = await supabaseAdmin
      .from('tickets')
      .select('id, buyer_id, refund_status, payment_provider_ref, payment_tx_ref, amount_paid, attendee_email, attendee_name')
      .eq('event_id', id)
      .eq('status', 'PAID');
    if (ticketsError) throw ticketsError;
    const { data: usedTickets, error: usedError } = await supabaseAdmin.from('tickets')
      .select('id').eq('event_id', id).eq('status', 'USED').limit(1);
    if (usedError) throw usedError;
    if (usedTickets?.length) {
      return NextResponse.json({ error: 'Checked-in tickets need support review before this event can be cancelled.' }, { status: 409 });
    }

    for (const ticket of paidTickets || []) {
      if (await isPaylukTicket(ticket.payment_tx_ref)) {
        return NextResponse.json({ error: 'This event has Payluk escrow tickets. Contact support to resolve their refunds before cancellation.' }, { status: 409 });
      }
      if (ticket.amount_paid > 0 && !ticket.payment_provider_ref) {
        return NextResponse.json({ error: `Ticket ${ticket.id} has no payment reference. Contact support before cancellation.` }, { status: 409 });
      }
      if (['initiating', 'needs-attention', 'failed'].includes(ticket.refund_status || '')) {
        return NextResponse.json({ error: `Ticket ${ticket.id} has a refund that needs support review.` }, { status: 409 });
      }
    }

    let refundsRequested = 0;
    const errors: string[] = [];
    const paymentRefs = [...new Set((paidTickets || [])
      .filter(ticket => Number(ticket.amount_paid) > 0)
      .map(ticket => ticket.payment_provider_ref as string))];

    for (const paymentRef of paymentRefs) {
      const orderTickets = (paidTickets || []).filter(ticket => ticket.payment_provider_ref === paymentRef);
      try {
        const alreadyPending = orderTickets.every(ticket => ['pending', 'processing'].includes(ticket.refund_status || ''));
        if (alreadyPending) {
          refundsRequested += orderTickets.length;
          continue;
        }
        if (orderTickets.some(ticket => ticket.refund_status)) throw new Error('Mixed refund state in one payment');
        await requestPaystackTicketRefund(paymentRef, orderTickets);
        refundsRequested += orderTickets.length;
        for (const ticket of orderTickets) {
          await supabaseAdmin.from('notifications').insert({
            user_id: ticket.buyer_id, type: 'event_cancelled',
            title: 'Event Cancelled — Refund Requested 💰',
            message: `"${event.title}" has been cancelled. A refund of ₦${Number(ticket.amount_paid).toLocaleString()} was requested; check your payment method for the final credit.`,
            related_id: id, related_type: 'event',
            data: { eventId: id, eventTitle: event.title, amount: ticket.amount_paid },
          });
        }
      } catch (err) {
        errors.push(`Payment ${paymentRef}: ${(err as Error).message}`);
      }
    }

    if (errors.length) {
      return NextResponse.json({ error: 'Some ticket refunds need support review.', refundsRequested, errors }, { status: 502 });
    }

    for (const ticket of (paidTickets || []).filter(ticket => Number(ticket.amount_paid) <= 0)) {
      const { error: updateError } = await supabaseAdmin.from('tickets')
        .update({ status: 'REFUNDED', refund_status: 'processed', updated_at: new Date().toISOString() })
        .eq('id', ticket.id).eq('status', 'PAID');
      if (updateError) errors.push(`Ticket ${ticket.id}: ${updateError.message}`);
    }

    if (errors.length) {
      return NextResponse.json({ error: 'Some ticket refunds need support review.', refundsRequested, errors }, { status: 502 });
    }

    const { error: cancelError } = await supabaseAdmin
      .from('events')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (cancelError) throw cancelError;

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'event_cancelled',
      properties: {
        event_id: id,
        refunds_requested: refundsRequested,
        refund_errors: errors.length,
      },
    });

    return NextResponse.json({
      success: true,
      refundsRequested,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Cancel event error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
