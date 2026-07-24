import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getPostHogClient } from '@/lib/posthog-server';
import { PaystackService } from '@/lib/paystack-service';

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
        id, status, payment_provider_ref, amount_paid, buyer_id,
        attendee_name, attendee_email,
        event:events!tickets_event_id_fkey(id, title, organizer_id)
      `)
      .eq('id', ticket_id)
      .single();

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const event = ticket.event as any;
    if (event.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Only the event organizer can issue refunds' }, { status: 403 });
    }

    if (ticket.status !== 'PAID') {
      return NextResponse.json({ error: `Ticket status is "${ticket.status}" — cannot refund` }, { status: 400 });
    }

    // ── Call Paystack refund API ─────────────────────────────────────
    if (ticket.payment_provider_ref && ticket.amount_paid > 0) {
      const refunded = await PaystackService.refundTransaction(
        ticket.payment_provider_ref,
        ticket.amount_paid
      );
      if (!refunded) {
        return NextResponse.json(
          { error: 'Refund failed — please try again or contact support' },
          { status: 502 }
        );
      }
    }

    // ── Update ticket status ─────────────────────────────────────────────────
    await supabaseAdmin
      .from('tickets')
      .update({ status: 'REFUNDED', updated_at: new Date().toISOString() })
      .eq('id', ticket_id);

    // ── Notify buyer ─────────────────────────────────────────────────────────
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: ticket.buyer_id,
        type: 'event_cancelled',
        title: '💰 Refund Issued',
        message: `Your ticket for "${event.title}" has been refunded. ₦${Number(ticket.amount_paid).toLocaleString()} will appear within 3–5 business days.`,
        related_id: event.id,
        related_type: 'event',
        data: { ticket_id, event_id: event.id, amount: ticket.amount_paid },
      });
    } catch (e) {
      console.error('Failed to send refund notification:', e);
    }

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'ticket_refunded',
      properties: {
        ticket_id,
        event_id: event.id,
        amount: ticket.amount_paid,
      },
    });

    return NextResponse.json({ success: true, message: 'Refund processed successfully' });
  } catch (error) {
    console.error('Ticket refund error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
