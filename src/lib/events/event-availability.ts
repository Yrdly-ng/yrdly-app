/** Mirrors purchase eligibility for presentation; the server remains authoritative. */
export function getTicketSaleAvailability(
  event: { status?: string; end_time?: string | null; is_archived?: boolean },
  tier: { is_visible?: boolean; capacity?: number | null; sold?: number; sale_ends_at?: string | null },
  now = Date.now(),
) {
  const closed = (label: string) => ({ available: false, label, maxQuantity: 0 });
  if (event.status === 'CANCELLED') return closed('Cancelled');
  if (event.status === 'COMPLETED') return closed('Ended');
  if (event.status !== 'PUBLISHED' || event.is_archived) return closed('Unavailable');
  const end = event.end_time ? Date.parse(event.end_time) : NaN;
  if (!Number.isFinite(end)) return closed('Unavailable');
  if (end <= now) return closed('Ended');
  if (tier.is_visible === false) return closed('Unavailable');
  if (tier.sale_ends_at) {
    const deadline = Date.parse(tier.sale_ends_at);
    if (!Number.isFinite(deadline) || deadline <= now) return closed('Sales closed');
  }
  const remaining = tier.capacity == null ? 5 : Math.max(0, tier.capacity - (tier.sold || 0));
  if (remaining <= 0) return closed('Sold out');
  return { available: true, label: 'Get tickets', maxQuantity: Math.min(5, remaining) };
}
