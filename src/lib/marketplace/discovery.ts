export const MARKETPLACE_CATEGORIES = [
  { label: "All Items", keywords: [] },
  {
    label: "Fashion",
    keywords: ["fashion", "clothing", "dress", "shirt", "shoe"],
  },
  {
    label: "Home & Living",
    keywords: ["furniture", "sofa", "home", "appliance", "kitchen", "decor"],
  },
  { label: "Vehicles", keywords: ["car", "vehicle", "motor", "tyre", "bike"] },
  { label: "Food", keywords: ["food", "cater", "meal", "groceries", "drink"] },
  {
    label: "Services",
    keywords: ["service", "repair", "clean", "installation"],
  },
  {
    label: "Phones",
    keywords: ["phone", "iphone", "samsung", "android", "smartphone"],
  },
  {
    label: "Accessories",
    keywords: ["accessor", "case", "charger", "headphone", "earbud", "cable"],
  },
  {
    label: "Health & Beauty",
    keywords: [
      "health",
      "beauty",
      "skincare",
      "cosmetic",
      "primrose",
      "oil",
      "cream",
    ],
  },
  {
    label: "Electronics",
    keywords: [
      "electronic",
      "laptop",
      "tv",
      "television",
      "computer",
      "gadget",
      "console",
    ],
  },
] as const;

export const MARKETPLACE_BUDGETS = [
  { value: "all", label: "All prices" },
  { value: "under-10000", label: "Under ₦10,000" },
  { value: "under-25000", label: "Under ₦25,000" },
  { value: "free", label: "Free" },
] as const;

export type MarketplaceBudget = (typeof MARKETPLACE_BUDGETS)[number]["value"];
export type MarketplaceSort = "newest" | "price-low" | "price-high";

interface DiscoverableListing {
  title?: string | null;
  text?: string | null;
  description?: string | null;
  sub_category?: string | null;
  price?: number | null;
  is_sold?: boolean;
  created_at?: string | null;
  timestamp?: string | null;
}

function validPrice(price: unknown): price is number {
  return typeof price === "number" && Number.isFinite(price) && price >= 0;
}

/** Filters the already location-scoped catalog; never changes checkout prices. */
export function discoverListings<T extends DiscoverableListing>(
  items: readonly T[],
  {
    search = "",
    category = "All Items",
    budget = "all",
    sort = "newest",
  }: {
    search?: string;
    category?: string;
    budget?: MarketplaceBudget;
    sort?: MarketplaceSort;
  } = {},
): T[] {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const keywords: readonly string[] =
    MARKETPLACE_CATEGORIES.find((item) => item.label === category)?.keywords ||
    [];
  const filtered = items.filter((item) => {
    if (item.is_sold) return false;
    const titleAndCategory = [item.title, item.text, item.sub_category]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    const searchable =
      `${titleAndCategory} ${item.description || ""}`.toLocaleLowerCase();
    if (!terms.every((term) => searchable.includes(term))) return false;
    if (
      keywords.length &&
      !keywords.some((keyword) => titleAndCategory.includes(keyword))
    )
      return false;
    if (budget === "all") return true;
    if (!validPrice(item.price)) return false;
    if (budget === "free") return item.price === 0;
    return item.price < (budget === "under-10000" ? 10000 : 25000);
  });
  return filtered.sort((a, b) => {
    if (sort !== "newest") {
      // Missing prices stay last in either direction, rather than looking free.
      if (!validPrice(a.price)) return validPrice(b.price) ? 1 : 0;
      if (!validPrice(b.price)) return -1;
      return sort === "price-low" ? a.price - b.price : b.price - a.price;
    }
    const time = (item: T) => {
      const value = Date.parse(item.created_at || item.timestamp || "");
      return Number.isFinite(value) ? value : 0;
    };
    return time(b) - time(a);
  });
}
