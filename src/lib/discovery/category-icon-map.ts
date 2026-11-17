/**
 * YRDLY category icon vocabulary (shared 1:1 with the web repository).
 * Source: mobile Explore tabs, legacy event categories, web category fallbacks,
 * business creation categories, business catalog sectors and their item categories.
 * Labels are NOT rewritten: this only picks a presentation icon for existing data.
 * Unknown administrator-created categories fall back to matching related words,
 * then a neutral tag icon; they are never silently excluded.
 */
export const CATEGORY_ICON_GROUPS = {
  all: ["All","All Items"],
  electronics: ["Electronics","Tech","Technology","Tech & Repair","Laptops","Desktops","Computers","Computer Parts","Tablets","Accessories"],
  phone: ["Phones","Mobile Phones","Phone & Laptop Repair"],
  home: ["Home & Living","Home & Garden","Home & Furniture","Furniture","Home Appliances","Home Decor","Bedding","Appliances","Kitchen & Dining","Lighting"],
  fashion: ["Fashion","Clothing","Footwear","Fabrics","Sportswear"],
  vehicles: ["Vehicles","Automotive","Car Parts","Tyres & Wheels","Car Accessories","Motorcycle Parts","Car Care"],
  food: ["Food","Food & Drink","Food & Drinks","Food & Catering","Restaurant & Café","Restaurant & Cafe","Meals","Snacks","Baked Goods","Groceries","Fresh Produce","Catering Packages","Desserts","Nutrition","Food Fair"],
  coffee: ["Drinks","Cafes & Restaurants","Café"],
  beauty: ["Beauty","Beauty & Salon","Beauty & Personal Care","Hair Care","Skin Care","Makeup","Fragrances","Nail Care","Beauty Tools","Salon Products"],
  services: ["Services","Local Services","Professional Services","Maintenance","Installation"],
  retail: ["Retail","Shopping"],
  health: ["Health","Health & Wellness","Personal Care","Wellness Products","Health Equipment","Supplements","First Aid","Mobility Aids"],
  fitness: ["Gyms & Fitness","Fitness Equipment","Sports & Fitness","Fitness Accessories"],
  music: ["Music","Live Music","Musical Instruments"],
  arts: ["Arts & Culture","Art & Culture","Art & Crafts"],
  community: ["Community","Social","Neighbourhood"],
  party: ["Party","Party Supplies","Party / Nightlife"],
  sports: ["Sports","Sports Equipment"],
  networking: ["Business / Networking","Business & Networking","Networking","Business"],
  education: ["Education","Workshop","Workshops"],
  laundry: ["Laundry","Laundry & Dry Cleaning"],
  tailoring: ["Tailoring","Tailoring & Fashion Design"],
  cleaning: ["Cleaning","Cleaning Services"],
  repairs: ["Repairs","Repair","Computer Repairs"],
  books: ["Books","Books & Media","Books & Stationery"],
  gaming: ["Gaming","Games & Consoles","Toys & Games"],
  printing: ["Printers & Office Equipment","Printing","Printing Services"],
  garden: ["Garden & Outdoor"],
  tools: ["Tools & Equipment","Tools & Supplies"],
  photography: ["Photography"],
  events: ["Events"],
  time: ["Today","This Week","Weekend","This weekend"],
  free: ["Free","Free / Giveaway","Giveaway"],
  kids: ["Kids & Baby","Family"],
  jewelry: ["Jewellery"],
  watch: ["Watches"],
  bags: ["Bags"],
  transport: ["Transport","Transportation"],
  safety: ["Noise & Disturbance","Suspicious Activity","Traffic & Parking","General Safety"],
  entertainment: ["Entertainment","Movies"],
  other: ["Other"],
} as const;

export type CategoryIconKey = keyof typeof CATEGORY_ICON_GROUPS;

export function normalizeCategoryLabel(label: string | null | undefined): string {
  return (label || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const exactCategoryIcons = new Map<string, CategoryIconKey>();
for (const key of Object.keys(CATEGORY_ICON_GROUPS) as CategoryIconKey[]) {
  for (const label of CATEGORY_ICON_GROUPS[key]) {
    exactCategoryIcons.set(normalizeCategoryLabel(label), key);
  }
}

/** Use the same semantic icon across web and mobile, regardless of category context. */
export function getCategoryIconKey(label: string | null | undefined): CategoryIconKey {
  const name = normalizeCategoryLabel(label);
  if (!name) return 'other';
  const exact = exactCategoryIcons.get(name);
  if (exact) return exact;
  // Dynamic categories from Supabase and pre-existing user-entered labels.
  if (/phone|iphone|smartphone|mobile/.test(name)) return 'phone';
  if (/laptop|computer|electronics|tech|digital|gadget/.test(name)) return 'electronics';
  if (/wash|laundry|dry clean/.test(name)) return 'laundry';
  if (/tailor|sew|fabric|stitch/.test(name)) return 'tailoring';
  if (/salon|beauty|hair|skin|makeup|nail/.test(name)) return 'beauty';
  if (/cater|food|restaurant|meal|bakery|drink|grocery/.test(name)) return 'food';
  if (/arts?|culture|craft|gallery/.test(name)) return 'arts';
  if (/music|concert|band/.test(name)) return 'music';
  if (/clean|housekeep/.test(name)) return 'cleaning';
  if (/repair|fix|maintenance/.test(name)) return 'repairs';
  if (/car|auto|vehicle|motor|tyre/.test(name)) return 'vehicles';
  if (/home|furnit|decor|appliance|interior/.test(name)) return 'home';
  if (/fashion|cloth|wear|shoe/.test(name)) return 'fashion';
  if (/medical|health|pharma|clinic|wellness/.test(name)) return 'health';
  if (/sport|gym|fitness/.test(name)) return 'sports';
  if (/photo|camera|video/.test(name)) return 'photography';
  if (/education|school|course|class|workshop/.test(name)) return 'education';
  if (/network|business|professional/.test(name)) return 'networking';
  if (/party|festival|nightlife/.test(name)) return 'party';
  if (/community|neighbou?rhood|social/.test(name)) return 'community';
  if (/book|stationery/.test(name)) return 'books';
  if (/transport|logistic|delivery/.test(name)) return 'transport';
  if (/garden|plant|flower/.test(name)) return 'garden';
  if (/service/.test(name)) return 'services';
  return 'other';
}
