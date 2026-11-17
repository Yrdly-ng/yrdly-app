# YRDLY category icons — approved design specification

The icon treatment reflects the three approved app-store mockups, **not** their fictional sellers, ratings, prices, event dates, "Featured" claims, or "Verified" business claims. The UI must display real YRDLY records, and the only currently supported identity trust label is **Phone verified**, when explicitly true.

## Design rules
- Simple, consistent outline icons inside rounded category chips or tiles, green accent for active state; dark/light mode contrast, minimum 40–44pt touch targets; preserve text labels.
- Both apps use this exact semantic category map. Native uses Ionicons; web uses Lucide. The precise glyph is platform-native but the category meaning is consistent.
- Do not rename or add categories in the backend to obtain an icon. Supabase-supplied categories use a normalized exact match, a relevant keyword fallback, then a generic tag.
- Marketplace examples: Electronics → laptop, Home & Living → home, Fashion → shirt.
- Events examples: Music → music notes, Food → restaurant, Arts & Culture → palette, Community → people.
- Business examples: Beauty & Salon → beauty, Laundry → washing-machine/water, Tailoring → scissors, Tech & Repair → laptop.
- "Today", "This Week", "Weekend" are **date filters**, not event types. They receive a clock icon and retain existing filtering.
- The storefront/checkout flow, review/rating counts, ticket status, and phone verification status must be read from actual data, never mocked.

## Category-to-icon vocabulary

The following labels cover the current mobile discovery filters, legacy events, web fallback categories and business creation groups, plus existing business catalog item classifications and common legacy labels. Future category values use fallback logic.

| Semantic key | Existing / supported labels |
|---|---|
| all | All, All Items |
| electronics | Electronics, Tech, Technology, Tech & Repair, Laptops, Desktops, Computers, Computer Parts, Tablets, Accessories |
| phone | Phones, Mobile Phones, Phone & Laptop Repair |
| home | Home & Living, Home & Garden, Home & Furniture, Furniture, Home Appliances, Home Decor, Bedding, Appliances, Kitchen & Dining, Lighting |
| fashion | Fashion, Clothing, Footwear, Fabrics, Sportswear |
| vehicles | Vehicles, Automotive, Car Parts, Tyres & Wheels, Car Accessories, Motorcycle Parts, Car Care |
| food | Food, Food & Drink, Food & Drinks, Food & Catering, Restaurant & Café, Restaurant & Cafe, Meals, Snacks, Baked Goods, Groceries, Fresh Produce, Catering Packages, Desserts, Nutrition, Food Fair |
| coffee | Drinks, Cafes & Restaurants, Café |
| beauty | Beauty, Beauty & Salon, Beauty & Personal Care, Health & Beauty, Hair Care, Skin Care, Makeup, Fragrances, Nail Care, Beauty Tools, Salon Products |
| services | Services, Local Services, Professional Services, Maintenance, Installation |
| retail | Retail, Shopping |
| health | Health, Health & Wellness, Personal Care, Wellness Products, Health Equipment, Supplements, First Aid, Mobility Aids |
| fitness | Gyms & Fitness, Fitness Equipment, Sports & Fitness, Fitness Accessories |
| music | Music, Live Music, Musical Instruments |
| arts | Arts & Culture, Art & Culture, Art & Crafts |
| community | Community, Social, Neighbourhood |
| party | Party, Party Supplies, Party / Nightlife |
| sports | Sports, Sports Equipment |
| networking | Business / Networking, Business & Networking, Networking, Business |
| education | Education, Workshop, Workshops |
| laundry | Laundry, Laundry & Dry Cleaning |
| tailoring | Tailoring, Tailoring & Fashion Design |
| cleaning | Cleaning, Cleaning Services |
| repairs | Repairs, Repair, Computer Repairs |
| books | Books, Books & Media, Books & Stationery |
| gaming | Gaming, Games & Consoles, Toys & Games |
| printing | Printers & Office Equipment, Printing, Printing Services |
| garden | Garden & Outdoor |
| tools | Tools & Equipment, Tools & Supplies |
| photography | Photography |
| events | Events |
| time | Today, This Week, Weekend, This weekend |
| free | Free, Free / Giveaway, Giveaway |
| kids | Kids & Baby, Family |
| jewelry | Jewellery |
| watch | Watches |
| bags | Bags |
| transport | Transport, Transportation |
| safety | Noise & Disturbance, Suspicious Activity, Traffic & Parking, General Safety |
| entertainment | Entertainment, Movies |
| other | Other |

## Implementation and QA
- Code source: `src/lib/discovery/category-icon-map.ts` in both repositories. Keep the complete contents identical.
- Platform renderers: `CategoryIcon` wrappers built on Expo Ionicons for mobile and lucide-react for web.
- Render category icons on Marketplace, Businessplace and Events filters, as well as visible legacy/dynamic category browsing where applicable.
- Validate no category is silently hidden, unknown labels use the neutral fallback, and physical QA in iOS/Android confirms alignment and accessibility.
