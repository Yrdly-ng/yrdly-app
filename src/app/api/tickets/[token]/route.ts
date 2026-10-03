import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthenticatedUser } from '@/lib/supabase-server';

/**
 * GET /api/tickets/[token]
 * Fetch ticket details by UUID token (the ticket ID itself is the QR token).
 * Requires authentication. Only the event organizer or the ticket holder may view.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { token } = await params;
  const { data: ticket, error } = await supabaseAdmin
    .from('tickets')
    .select(`
      id, buyer_id, status, refund_status, attendee_name, attendee_email, amount_paid, created_at, scanned_at,
      event:events(id, organizer_id, title, cover_image_url, start_time, end_time, location_address, location_online, online_link, status, lga, state),
      tier:ticket_tiers(id, name, price, description)
    `)
    .eq('id', token)
    .single();

  if (error || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.buyer_id !== user.id && (ticket.event as any)?.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ ticket });
}
