import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getPostHogClient } from '@/lib/posthog-server';

/**
 * POST /api/events/checkin
 * Validates a ticket_code and marks the ticket as USED. Organizer-only.
 * Body: { ticket_code: string, event_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const { ticket_code, event_id } = await request.json();
    if (!ticket_code || !event_id) {
      return NextResponse.json({ error: 'ticket_code and event_id are required' }, { status: 400 });
    }

    // Verify organizer
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, organizer_id, status')
      .eq('id', event_id)
      .single();

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.organizer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (event.status === 'CANCELLED') return NextResponse.json({ error: 'Event is cancelled' }, { status: 400 });

    // Find ticket
    const { data: ticket } = await supabaseAdmin
      .from('tickets')
      .select('id, status, attendee_name, attendee_email, expires_at, tier:ticket_tiers!tickets_tier_id_fkey(name)')
      .eq('ticket_code', ticket_code.trim().toUpperCase())
      .eq('event_id', event_id)
      .single();

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

    // Mark as USED
    const now = new Date().toISOString();
    await supabaseAdmin
      .from('tickets')
      .update({ status: 'USED', scanned_at: now, scanned_by: user.id, updated_at: now })
      .eq('id', ticket.id);

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'ticket_checked_in',
      properties: {
        event_id,
        ticket_id: ticket.id,
        tier_name: (ticket.tier as any)?.name,
      },
    });

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
