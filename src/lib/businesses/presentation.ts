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

/** Match checkout's inventory precedence, including older items without counts. */
export function isCatalogItemAvailable(item: {
  in_stock: boolean;
  quantity?: number | null;
  inventory_count?: number | null;
}): boolean {
  return item.in_stock && (item.quantity ?? item.inventory_count ?? 1) > 0;
}

/** Customers can see sold-out items; owners can filter them out. */
export function getBusinessCatalogItems<T extends { in_stock: boolean; quantity?: number | null; inventory_count?: number | null }>(
  items: T[],
  isOwner: boolean,
  showOutOfStock: boolean,
): T[] {
  if (!isOwner || showOutOfStock) return items;
  return items.filter(isCatalogItemAvailable);
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
