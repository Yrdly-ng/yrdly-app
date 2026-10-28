const NON_ENGAGEMENT_CATEGORIES = new Set([
  "event",
  "for sale",
  "selling",
  "giveaway",
  "business",
  "marketplace",
]);

export function supportsPostEngagement(category?: string | null): boolean {
  return !NON_ENGAGEMENT_CATEGORIES.has(category?.trim().toLowerCase() || "");
}
