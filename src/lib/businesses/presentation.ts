/** Display only recorded business information; missing data must not imply availability. */
export function getBusinessModeLabel(mode?: string | null): string {
  if (mode === "service") return "Services";
  if (mode === "product") return "Products";
  if (mode === "both") return "Products & services";
  return "Local business";
}

/** Product catalog visibility follows the saved business type, never item presence. */
export function shouldShowBusinessCatalog(
  mode: string | null | undefined,
  _catalogCount: number,
  _catalogError = false,
): boolean {
  return mode === "product" || mode === "both";
}

/** Match the mobile storefront: customers can see sold-out items and their
 * availability badge. Owners can hide sold-out items until they turn the
 * existing control on. Quantity is not used as a second stock flag. */
export function getBusinessCatalogItems<T extends { in_stock: boolean }>(
  items: T[],
  isOwner: boolean,
  showOutOfStock: boolean,
): T[] {
  if (!isOwner || showOutOfStock) return items;
  return items.filter((item) => item.in_stock);
}

/** A cover is not a business logo; use the explicit logo fields only. */
export function getBusinessLogo(business: {
  logo?: string | null;
  logo_url?: string | null;
}): string | null {
  return business.logo_url?.trim() || business.logo?.trim() || null;
}

export function getCatalogItemImage(images?: readonly string[] | null): string {
  return images?.find((image) => typeof image === "string" && image.trim()) || "/placeholder.svg";
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
