/** Display only recorded business information; missing data must not imply availability. */
export function getBusinessModeLabel(mode?: string | null): string {
  if (mode === "service") return "Services";
  if (mode === "product") return "Products";
  if (mode === "both") return "Products & services";
  return "Local business";
}

export function getBusinessLocation(
  location: unknown,
  lga?: string | null,
  state?: string | null,
): string | null {
  const address =
    typeof location === "string"
      ? location
      : location && typeof location === "object" && "address" in location
        ? (location as { address?: unknown }).address
        : null;
  if (typeof address === "string" && address.trim()) return address.trim();
  const region = [lga, state]
    .filter((part): part is string => typeof part === "string" && !!part.trim())
    .map((part) => part.trim())
    .join(", ");
  return region || null;
}

export function getBusinessRating(
  rating?: number | null,
  count?: number | null,
): string | null {
  if (
    !Number.isFinite(rating) ||
    !Number.isFinite(count) ||
    !rating ||
    rating <= 0 ||
    rating > 5 ||
    !count ||
    count <= 0 ||
    !Number.isInteger(count)
  )
    return null;
  return `${rating.toFixed(1)} (${count})`;
}
