import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthenticatedUser } from '@/lib/supabase-server';

/**
 * GET /api/tickets/[token]
 * Fetch ticket details by UUID token (the ticket ID itself is the QR token).
 * Requires authentication. Only the event organizer or the ticket holder may view.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // Require authentication
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { token } = await params;
  const { data: ticket, error } = await supabaseAdmin
    .from('tickets')
    .select(`
      id, status, attendee_name, attendee_email, amount_paid, created_at, scanned_at,
      event:events(id, title, cover_image_url, start_time, end_time, location_address, location_online, online_link, status, lga, state, user_id),
      tier:ticket_tiers(id, name, price, description)
    `)
    .eq('id', token)
    .single();

  if (error || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // Only the event organizer or the ticket holder may view this ticket
  const eventUserId = (ticket.event as any)?.user_id;
  const isOrganizer = user.id === eventUserId;
  const isTicketHolder = user.email === ticket.attendee_email;

  if (!isOrganizer && !isTicketHolder) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ ticket });
}
