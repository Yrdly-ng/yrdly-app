import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/events/cancel
 * Cancels an event owned by the authenticated organizer.
 */
export async function POST(request: NextRequest) {
  try {
    const {
      data: { user },
      error: authError,
    } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { eventId, reason } = body;

    if (!eventId) {
      return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });
    }

    // 1. Fetch event and check ownership
    const { data: event, error: fetchError } = await supabaseAdmin
      .from('events')
      .select('id, organizer_id, status, title')
      .eq('id', eventId)
      .maybeSingle();

    if (fetchError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.organizer_id !== user.id) {
      return NextResponse.json(
        { error: 'You do not have permission to cancel this event' },
        { status: 403 }
      );
    }

    if (event.status === 'CANCELLED') {
      return NextResponse.json(
        { message: 'Event is already cancelled' },
        { status: 200 }
      );
    }

    // 2. Update event status
    const { error: updateError } = await supabaseAdmin
      .from('events')
      .update({
        status: 'CANCELLED',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || 'Cancelled by organizer',
      })
      .eq('id', eventId);

    if (updateError) {
      console.error('[CancelEvent] Error updating event:', updateError);
      return NextResponse.json({ error: 'Failed to cancel event' }, { status: 500 });
    }

    // 3. Update associated tickets to CANCELLED status
    await supabaseAdmin
      .from('tickets')
      .update({ status: 'CANCELLED' })
      .eq('event_id', eventId)
      .neq('status', 'USED');

    return NextResponse.json({
      success: true,
      message: 'Event successfully cancelled',
    });
  } catch (err: any) {
    console.error('[CancelEvent] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
