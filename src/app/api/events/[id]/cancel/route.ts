import { after, NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { deliverEventCancellationNotifications } from '@/lib/events/event-cancellation-notifications';

export const maxDuration = 300;

/** Cancels only after paid refunds clear; queues attendee notices atomically. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });

    const { data, error } = await supabaseAdmin.rpc('cancel_event_with_notifications', {
      p_event_id: id,
      p_organizer_id: user.id,
    });
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (error.code === 'P0002') return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      if (error.code === 'P0001') {
        const message = error.message === 'event_cancellation_checked_in_tickets'
          ? 'Checked-in tickets need support review before this event can be cancelled.'
          : 'Refund all paid tickets before cancelling this event. Contact support for payments that require review.';
        return NextResponse.json({ error: message }, { status: 409 });
      }
      throw new Error('Event cancellation transaction failed');
    }

    after(async () => {
      try {
        await deliverEventCancellationNotifications(id);
      } catch {
        // The durable queue remains available to the scheduled delivery worker.
        console.error('Event cancellation notification delivery requires retry');
      }
    });
    return NextResponse.json(data);
  } catch {
    console.error('Event cancellation failed');
    return NextResponse.json({ error: 'Unable to cancel the event. Please try again.' }, { status: 500 });
  }
}
