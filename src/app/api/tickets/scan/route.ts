import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/tickets/scan
 * Scans a ticket token. Returns the attendee info if valid, or an error if invalid/used.
 */
export async function POST(request: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });

    const { ticketId, ticketCode, ticketInput, eventId } = await request.json();
    const input = ticketInput || ticketCode || ticketId;

    if (!input || !eventId) {
      return NextResponse.json({ error: 'Ticket code/ID and eventId are required' }, { status: 400 });
    }

    const { data: event, error: eventError } = await supabaseAdmin.from('events')
      .select('organizer_id, status').eq('id', eventId).single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.organizer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (event.status === 'CANCELLED') return NextResponse.json({ error: 'Event is cancelled' }, { status: 409 });

    const { data: result, error: rpcError } = await supabaseAdmin.rpc('scan_ticket', {
      p_ticket_input: input,
      p_scanner_id: user.id,
      p_event_id: eventId
    });

    if (rpcError) {
      console.error('Scan ticket rpc error:', rpcError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Scan ticket error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
