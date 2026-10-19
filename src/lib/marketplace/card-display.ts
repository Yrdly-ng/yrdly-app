interface ListingMedia {
  image_urls?: unknown;
  image_url?: unknown;
  video_thumbnail_url?: unknown;
}

function usableImage(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getListingCover(item: ListingMedia): string | undefined {
  let images = item.image_urls;
  if (typeof images === "string") {
    try {
      images = JSON.parse(images);
    } catch {
      images = [];
    }
  }
  const candidates = [
    ...(Array.isArray(images) ? images : []),
    item.image_url,
    item.video_thumbnail_url,
  ];
  return candidates.find(usableImage)?.trim();
}

export function getListingPriceLabel(
  price: unknown,
  format: (amount: number) => string,
): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    return "Price unavailable";
  }
  return price === 0 ? "Free" : format(price);
}
