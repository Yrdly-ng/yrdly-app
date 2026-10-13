import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/events/[id]/cancel
 * Cancels free-ticket events. Paid ticket refunds require support resolution first.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });

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

    // Paid escrow refunds require support resolution before cancellation.
    // Never mark tickets refunded or notify buyers of money that was not returned.
    if ((paidTickets || []).some(ticket => (ticket.amount_paid == null || Number(ticket.amount_paid) !== 0))) {
      return NextResponse.json({ error: 'This event has paid tickets. Contact support to resolve Payluk escrow refunds before cancellation.' }, { status: 409 });
    }

    const errors: string[] = [];
    for (const ticket of (paidTickets || []).filter(ticket => ticket.amount_paid != null && Number(ticket.amount_paid) === 0)) {
      const { error: updateError } = await supabaseAdmin.from('tickets')
        .update({ status: 'REFUNDED', refund_status: 'processed', updated_at: new Date().toISOString() })
        .eq('id', ticket.id).eq('status', 'PAID');
      if (updateError) errors.push(`Ticket ${ticket.id}: ${updateError.message}`);
    }

    if (errors.length) {
      return NextResponse.json({ error: 'Some ticket refunds need support review.', errors }, { status: 502 });
    }

    const { error: cancelError } = await supabaseAdmin
      .from('events')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (cancelError) throw cancelError;

    return NextResponse.json({
      success: true,
      refundsRequested: 0,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Cancel event error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
