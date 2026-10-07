import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPushNotification } from '@/lib/server-push-notification';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  // Hobby cron runs once daily and can be delayed by up to 59 minutes.
  // Look ahead 25 hours so each event is still picked up around a day ahead.
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  try {
    const { data: events, error: eventError } = await supabaseAdmin
      .from('events')
      .select('id, title, start_time')
      .in('status', ['PUBLISHED', 'published'])
      .gte('start_time', now.toISOString())
      .lte('start_time', windowEnd.toISOString());
    if (eventError) throw eventError;
    if (!events?.length) return NextResponse.json({ success: true, remindersSent: 0 });

    const eventIds = events.map((event) => event.id);
    const [{ data: tickets, error: ticketError }, { data: existing, error: existingError }] = await Promise.all([
      supabaseAdmin
        .from('tickets')
        .select('event_id, buyer_id')
        .in('event_id', eventIds)
        .eq('status', 'PAID'),
      supabaseAdmin
        .from('notifications')
        .select('user_id, related_id')
        .eq('type', 'event_reminder')
        .in('related_id', eventIds),
    ]);
    if (ticketError) throw ticketError;
    if (existingError) throw existingError;

    const alreadySent = new Set((existing || []).map((row) => `${row.user_id}:${row.related_id}`));
    const eventById = new Map(events.map((event) => [event.id, event]));
    const ticketHolders = new Set<string>();
    for (const ticket of tickets || []) {
      if (ticket.buyer_id) ticketHolders.add(`${ticket.event_id}:${ticket.buyer_id}`);
    }

    let remindersSent = 0;
    const failures: string[] = [];
    for (const entry of ticketHolders) {
      const [eventId, userId] = entry.split(':');
      const event = eventById.get(eventId);
      if (!event || alreadySent.has(`${userId}:${eventId}`)) continue;

      const title = 'Event starting soon';
      const message = `"${event.title}" is coming up soon. Check the event details.`;
      const data = { eventId, eventTitle: event.title, startTime: event.start_time };
      const { data: notification, error } = await supabaseAdmin.rpc('create_notification', {
        p_user_id: userId,
        p_type: 'event_reminder',
        p_title: title,
        p_message: message,
        p_sender_id: null,
        p_related_id: eventId,
        p_related_type: 'event',
        p_data: data,
      });
      if (error) {
        failures.push(`${eventId}:${userId}`);
        console.error('[CRON] Event reminder insert failed:', error);
        continue;
      }

      const shouldPush = (notification as { should_push?: boolean } | null)?.should_push !== false;
      if (shouldPush) {
        await sendPushNotification(supabaseAdmin, userId, { title, body: message, data, url: `/events/${eventId}` }, 'event_reminder');
      }
      alreadySent.add(`${userId}:${eventId}`);
      remindersSent++;
    }

    return NextResponse.json({ success: failures.length === 0, remindersSent, failures: failures.length });
  } catch (error) {
    console.error('[CRON] Event reminder processing failed:', error);
    return NextResponse.json({ error: 'Event reminder processing failed' }, { status: 500 });
  }
}
