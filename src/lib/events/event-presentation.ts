/** Presentation only: never infer that an unknown ticket price is free. */
export function getEventPriceLabel(
  event: {
    price?: unknown;
    is_free?: boolean;
    ticket_tiers?: { price?: unknown; is_visible?: boolean }[] | null;
  },
  formatPrice: (value: number) => string,
): string {
  const visibleTiers =
    event.ticket_tiers?.filter((tier) => tier.is_visible !== false) || [];
  const validPrice = (value: unknown): value is number | string =>
    value !== null &&
    value !== undefined &&
    (typeof value !== "string" || value.trim() !== "") &&
    (typeof value === "number" || typeof value === "string") &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0;
  const prices = visibleTiers
    .filter((tier) => validPrice(tier.price))
    .map((tier) => Number(tier.price));
  if (visibleTiers.length && prices.length !== visibleTiers.length)
    return "View tickets";
  if (prices.length) {
    const minimum = Math.min(...prices);
    if (
      prices.every((price) => price === 0) &&
      prices.length === visibleTiers.length
    )
      return "Free entry";
    return minimum === 0
      ? "Free & paid tickets"
      : `From ${formatPrice(minimum)}`;
  }
  if (event.is_free === true) return "Free entry";
  if (validPrice(event.price))
    return Number(event.price) === 0
      ? "Free entry"
      : formatPrice(Number(event.price));
  return "View tickets";
}

export function getEventDateInfo(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    day: date.toLocaleDateString("en-GB", { day: "2-digit" }),
    month: date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
    full: date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    time: date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

/** Calendar filtering uses local days rather than a rolling 48-hour estimate. */
export function matchesEventDay(
  value: string,
  filter: "Today" | "This weekend",
  now = new Date(),
) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === "Today")
    return (
      date >= start &&
      date <
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
    );
  const saturday = new Date(start);
  saturday.setDate(
    start.getDate() +
      (start.getDay() === 0 ? -1 : (6 - start.getDay() + 7) % 7),
  );
  const monday = new Date(saturday);
  monday.setDate(saturday.getDate() + 2);
  return date >= saturday && date < monday;
}
