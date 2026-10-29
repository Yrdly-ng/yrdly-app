/** Only fixed event names leave the API boundary. Request bodies and references never do. */
export function flowEvent(path: string, phase: 'started' | 'succeeded' | 'failed', result?: unknown): string | null {
  const data = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  if (path === '/api/events/tickets/purchase') {
    if (phase === 'started') return 'ticket_checkout_started';
    if (phase === 'failed' || data.success !== true) return 'ticket_checkout_failed';
    return data.free || data.alreadyPaid ? 'ticket_issued' : 'ticket_checkout_opened';
  }
  if (path === '/api/events/tickets/verify') {
    if (phase === 'failed') return 'ticket_verification_failed';
    return phase === 'succeeded' && data.success === true && data.ticket ? 'ticket_issued' : null;
  }
  if (path === '/api/events/tickets/refund') return phase === 'started' ? null : phase === 'failed' ? 'ticket_refund_failed' : 'ticket_refund_requested';
  if (/^\/api\/events\/[^/]+\/earnings\/withdraw$/.test(path)) return phase === 'started' ? null : phase === 'failed' ? 'event_withdrawal_failed' : 'event_withdrawal_requested';
  if (path === '/api/bookings/checkout') return phase === 'started' ? 'booking_checkout_started' : phase === 'failed' ? 'booking_checkout_failed' : null;
  if (path === '/api/bookings/verify') return phase === 'succeeded' && data.success === true ? 'booking_payment_confirmed' : null;
  return null;
}
