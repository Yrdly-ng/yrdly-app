/** Item categories follow the business sector, independently of product/service mode. */
const CATALOG_CATEGORIES: Record<string, readonly string[]> = {
  tech: [
    "Laptops",
    "Mobile Phones",
    "Desktops",
    "Tablets",
    "Accessories",
    "Computer Parts",
    "Networking",
    "Gaming",
    "Printers & Office Equipment",
    "Repairs",
    "Other",
  ],
  food: [
    "Meals",
    "Snacks",
    "Baked Goods",
    "Drinks",
    "Groceries",
    "Fresh Produce",
    "Catering Packages",
    "Desserts",
    "Other",
  ],
  fashion: [
    "Clothing",
    "Footwear",
    "Bags",
    "Jewellery",
    "Watches",
    "Accessories",
    "Fabrics",
    "Tailoring",
    "Other",
  ],
  beauty: [
    "Hair Care",
    "Skin Care",
    "Makeup",
    "Fragrances",
    "Nail Care",
    "Beauty Tools",
    "Salon Products",
    "Other",
  ],
  health: [
    "Personal Care",
    "Wellness Products",
    "Health Equipment",
    "Supplements",
    "First Aid",
    "Mobility Aids",
    "Other",
  ],
  fitness: [
    "Fitness Equipment",
    "Sportswear",
    "Sports Equipment",
    "Fitness Accessories",
    "Nutrition",
    "Other",
  ],
  home: [
    "Furniture",
    "Home Appliances",
    "Kitchen & Dining",
    "Home Decor",
    "Bedding",
    "Garden & Outdoor",
    "Lighting",
    "Other",
  ],
  automotive: [
    "Car Parts",
    "Tyres & Wheels",
    "Car Accessories",
    "Motorcycle Parts",
    "Tools & Equipment",
    "Car Care",
    "Repairs",
    "Other",
  ],
  entertainment: [
    "Games & Consoles",
    "Books",
    "Music",
    "Movies",
    "Musical Instruments",
    "Party Supplies",
    "Art & Crafts",
    "Other",
  ],
  services: [
    "Repairs",
    "Cleaning",
    "Installation",
    "Maintenance",
    "Professional Services",
    "Tools & Supplies",
    "Other",
  ],
  general: [
    "Electronics",
    "Mobile Phones",
    "Computers",
    "Clothing",
    "Footwear",
    "Beauty & Personal Care",
    "Food & Drinks",
    "Groceries",
    "Home & Furniture",
    "Appliances",
    "Books & Stationery",
    "Toys & Games",
    "Sports & Fitness",
    "Automotive",
    "Tools & Equipment",
    "Other",
  ],
};

function catalogSector(category?: string | null): string {
  const value = (category || "").trim().toLowerCase();
  if (/tech|electronic|computer|phone/.test(value)) return "tech";
  if (/restaurant|caf[eé]|food|cater|bakery|drink/.test(value)) return "food";
  if (/fashion|apparel|cloth|tailor/.test(value)) return "fashion";
  if (/beauty|salon|hair|cosmetic/.test(value)) return "beauty";
  if (/gym|fitness|sport/.test(value)) return "fitness";
  if (/health|wellness|pharma/.test(value)) return "health";
  if (/home|furniture|garden|decor/.test(value)) return "home";
  if (/auto|vehicle|motor/.test(value)) return "automotive";
  if (/entertain|book|music|art|craft/.test(value)) return "entertainment";
  if (/service|repair|clean|maintenan/.test(value)) return "services";
  return "general";
}

export function getCatalogCategories(
  businessCategory?: string | null,
  currentCategory?: string | null,
): string[] {
  const categories = [...CATALOG_CATEGORIES[catalogSector(businessCategory)]];
  const current = currentCategory?.trim();
  // Retain older/custom labels when editing rather than silently changing inventory.
  if (current && !categories.includes(current)) categories.push(current);
  return categories;
}

export const MAX_CATALOG_IMAGES = 4;
