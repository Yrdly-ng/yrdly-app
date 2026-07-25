import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';
import { getPostHogClient } from '@/lib/posthog-server';
import { PaystackService } from '@/lib/paystack-service';

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

    // Mark event as CANCELLED
    await supabaseAdmin
      .from('events')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', id);

    // Fetch all PAID tickets for this event
    const { data: paidTickets } = await supabaseAdmin
      .from('tickets')
      .select('id, buyer_id, payment_provider_ref, amount_paid, attendee_email, attendee_name')
      .eq('event_id', id)
      .eq('status', 'PAID');

    let refunded = 0;
    const errors: string[] = [];

    for (const ticket of paidTickets || []) {
      try {
        // Refund via Paystack if we have a payment reference
        if (ticket.payment_provider_ref && ticket.amount_paid > 0) {
          const refunded = await PaystackService.refundTransaction(
            ticket.payment_provider_ref,
            ticket.amount_paid
          );
          if (!refunded) {
            errors.push(`Ticket ${ticket.id}: Paystack refund failed`);
          }
        }

        // Mark ticket as REFUNDED
        await supabaseAdmin
          .from('tickets')
          .update({ status: 'REFUNDED', updated_at: new Date().toISOString() })
          .eq('id', ticket.id);

        // Notify buyer
        await supabaseAdmin.from('notifications').insert({
          user_id: ticket.buyer_id,
          type: 'event_cancelled',
          title: `Event Cancelled — Refund Issued 💰`,
          message: `"${event.title}" has been cancelled. Your refund of ₦${ticket.amount_paid.toLocaleString()} will appear within 3–5 business days.`,
          related_id: id,
          related_type: 'event',
          data: { eventId: id, eventTitle: event.title, amount: ticket.amount_paid },
        });

        refunded++;
      } catch (err) {
        errors.push(`Ticket ${ticket.id}: ${(err as Error).message}`);
      }
    }

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'event_cancelled',
      properties: {
        event_id: id,
        tickets_refunded: refunded,
        refund_errors: errors.length,
      },
    });

    return NextResponse.json({
      success: true,
      refunded,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Cancel event error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
