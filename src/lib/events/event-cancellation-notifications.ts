import 'server-only';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { ResendEmailService } from '@/lib/email/resend-service';
import { invokeServerFunction } from '@/lib/notifications/server-functions';

/** Bounded durable delivery. Cancellation and in-app notices already committed. */
export async function deliverEventCancellationNotifications(eventId?: string) {
  const now = new Date().toISOString();
  let query = supabaseAdmin.from('event_cancellation_deliveries').select('*')
    .in('status', ['pending', 'processing']).lte('retry_at', now)
    .or(`locked_until.is.null,locked_until.lt.${now}`).order('retry_at').limit(100);
  if (eventId) query = query.eq('event_id', eventId);
  const { data: candidates, error } = await query;
  if (error) throw new Error('Cancellation delivery queue unavailable');
  const result = { checked: candidates?.length || 0, sent: 0, retrying: 0, review: 0 };

  async function deliver(candidate: NonNullable<typeof candidates>[number]) {
    const lease = randomUUID();
    const claimed = await supabaseAdmin.from('event_cancellation_deliveries').update({
      status: 'processing', lease_token: lease, attempts: candidate.attempts + 1,
      locked_until: new Date(Date.now() + 120_000).toISOString(),
    }).eq('id', candidate.id).in('status', ['pending', 'processing'])
      .or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`).select('*').maybeSingle();
    if (claimed.error) throw new Error('Cancellation delivery claim unavailable');
    const row = claimed.data;
    if (!row) return;
    async function checkpoint(update: Record<string, unknown>) {
      const saved = await supabaseAdmin.from('event_cancellation_deliveries').update(update)
        .eq('id', row.id).eq('lease_token', lease).select('id').maybeSingle();
      if (saved.error || !saved.data) throw new Error('Cancellation delivery checkpoint unavailable');
    }
    try {
      // Resend retains idempotency keys for 24h. Never blindly retry an uncertain
      // send beyond that window; a human must reconcile the existing provider send.
      if (row.channel === 'email' && row.first_attempt_at &&
          Date.now() - Date.parse(row.first_attempt_at) >= 23 * 3600000) {
        await checkpoint({ status: 'review', last_error: 'Email retry requires provider reconciliation', locked_until: null, lease_token: null });
        result.review++;
        return;
      }
      if (row.channel === 'email' && !ResendEmailService.isConfigured()) throw new Error('Email is not configured');
      if (!row.first_attempt_at) await checkpoint({ first_attempt_at: new Date().toISOString() });
      if (row.channel === 'push') {
        const response = await invokeServerFunction<{ success?: boolean; skipped?: boolean; reason?: string }>(supabaseAdmin, 'send-push-notification', {
          userId: row.buyer_id, type: 'event_cancelled', payload: {
            title: 'Event cancelled', body: `“${row.event_title}” has been cancelled. Open your tickets for details.`,
            url: '/my-tickets', data: { type: 'event_cancelled', eventId: row.event_id, eventTitle: row.event_title,
              notificationId: row.notification_id, deliveryKey: `event-cancellation:${row.id}` },
          },
        });
        // Missing devices and opted-out recipients are terminal delivery skips.
        if (response.error || (!response.data?.success && !response.data?.skipped && response.data?.reason !== 'no_token')) {
          throw new Error('Push delivery was not accepted');
        }
      } else if (row.channel === 'email' && row.email) {
        await ResendEmailService.sendEventCancellationEmail(row.email, row.attendee_name, row.event_title,
          row.start_time, row.event_location, `event-cancellation:${row.id}`);
      } else {
        throw new Error('Invalid cancellation delivery');
      }
      await checkpoint({ status: 'sent', sent_at: new Date().toISOString(), last_error: null, locked_until: null, lease_token: null });
      result.sent++;
    } catch {
      const needsReview = row.attempts >= 8;
      // The lease condition prevents a delayed worker overwriting a newer claim.
      const retry = await supabaseAdmin.from('event_cancellation_deliveries').update({
        status: needsReview ? 'review' : 'pending', last_error: 'Delivery requires retry or review',
        retry_at: new Date(Date.now() + Math.min(6 * 3600000, 300000 * 2 ** Math.min(row.attempts, 6))).toISOString(),
        locked_until: null, lease_token: null,
      }).eq('id', row.id).eq('lease_token', lease);
      if (retry.error) throw new Error('Cancellation delivery retry unavailable');
      if (needsReview) result.review++; else result.retrying++;
    }
  }
  // Keep provider traffic and function runtime bounded for large events.
  for (let i = 0; i < (candidates?.length || 0); i += 5) {
    await Promise.all(candidates!.slice(i, i + 5).map(deliver));
  }
  return result;
}
