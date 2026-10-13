import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/events/checkin
 * Validates a ticket_code and marks the ticket as USED. Organizer-only.
 * Body: { ticket_code: string, event_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });

    const { ticket_code, event_id } = await request.json();
    if (typeof ticket_code !== 'string' || !ticket_code.trim() || ticket_code.length > 200 ||
        typeof event_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(event_id)) {
      return NextResponse.json({ error: 'ticket_code and event_id are required' }, { status: 400 });
    }

    // Verify organizer
    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('id, organizer_id, status')
      .eq('id', event_id)
      .single();

    if (eventError && eventError.code !== 'PGRST116') throw eventError;
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.organizer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (event.status === 'CANCELLED') return NextResponse.json({ error: 'Event is cancelled' }, { status: 400 });

    // Find ticket
    const input = ticket_code.trim();
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .select('id, status, refund_status, attendee_name, attendee_email, expires_at, tier:ticket_tiers!tickets_tier_id_fkey(name)')
      .eq(isId ? 'id' : 'ticket_code', isId ? input : input.toUpperCase())
      .eq('event_id', event_id)
      .single();

    if (ticketError && ticketError.code !== 'PGRST116') throw ticketError;
    if (!ticket) {
      return NextResponse.json({ valid: false, error: 'INVALID_TICKET', message: 'Ticket not found for this event' }, { status: 404 });
    }
    if (ticket.expires_at && new Date(ticket.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, error: 'TICKET_EXPIRED', message: 'This ticket has expired' }, { status: 400 });
    }
    if (ticket.status === 'USED') {
      return NextResponse.json({ valid: false, error: 'ALREADY_SCANNED', message: 'Ticket already used', attendee_name: ticket.attendee_name }, { status: 409 });
    }
    if (ticket.status !== 'PAID') {
      return NextResponse.json({ valid: false, error: 'TICKET_INVALID', message: `Ticket is ${ticket.status.toLowerCase()}` }, { status: 400 });
    }
    if (ticket.refund_status) {
      return NextResponse.json({ valid: false, error: 'REFUND_IN_PROGRESS', message: 'This ticket has a refund request or review in progress' }, { status: 409 });
    }

    // Mark as USED
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('tickets')
      .update({ status: 'USED', scanned_at: now, scanned_by: user.id, updated_at: now })
      .eq('id', ticket.id).eq('status', 'PAID').is('refund_status', null)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .select('id');
    if (updateError) throw updateError;
    if (!updated?.length) return NextResponse.json({ valid: false, error: 'TICKET_CHANGED', message: 'Ticket status changed; scan again' }, { status: 409 });

    return NextResponse.json({
      valid: true,
      message: 'Check-in successful!',
      attendee_name: ticket.attendee_name,
      attendee_email: ticket.attendee_email,
      tier_name: (ticket.tier as any)?.name,
    });
  } catch (error) {
    console.error('Check-in error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
