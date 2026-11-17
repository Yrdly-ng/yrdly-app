import {
  LayoutGrid, Laptop, Smartphone, House, Shirt, CarFront, Utensils,
  Coffee, Sparkles, Wrench, Store, HeartPulse, Dumbbell, Music2,
  Palette, Users, PartyPopper, Trophy, Network, GraduationCap,
  WashingMachine, Scissors, SprayCan, Hammer, BookOpen, Gamepad2,
  Printer, Flower2, Camera, CalendarDays, Clock3, Gift, Baby, Gem,
  Watch, ShoppingBag, BusFront, ShieldAlert, Clapperboard, Tag,
  type LucideIcon,
} from 'lucide-react';
import { getCategoryIconKey, type CategoryIconKey } from '@/lib/discovery/category-icon-map';

// Same semantic keys as mobile's Ionicons renderer, using Lucide outlines.
export const WEB_CATEGORY_ICONS: Record<CategoryIconKey, LucideIcon> = {
  all: LayoutGrid,
  electronics: Laptop,
  phone: Smartphone,
  home: House,
  fashion: Shirt,
  vehicles: CarFront,
  food: Utensils,
  coffee: Coffee,
  beauty: Sparkles,
  services: Wrench,
  retail: Store,
  health: HeartPulse,
  fitness: Dumbbell,
  music: Music2,
  arts: Palette,
  community: Users,
  party: PartyPopper,
  sports: Trophy,
  networking: Network,
  education: GraduationCap,
  laundry: WashingMachine,
  tailoring: Scissors,
  cleaning: SprayCan,
  repairs: Wrench,
  books: BookOpen,
  gaming: Gamepad2,
  printing: Printer,
  garden: Flower2,
  tools: Hammer,
  photography: Camera,
  events: CalendarDays,
  time: Clock3,
  free: Gift,
  kids: Baby,
  jewelry: Gem,
  watch: Watch,
  bags: ShoppingBag,
  transport: BusFront,
  safety: ShieldAlert,
  entertainment: Clapperboard,
  other: Tag,
};

export function CategoryIcon({
  category,
  size = 18,
  className,
}: {
  category: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const Icon = WEB_CATEGORY_ICONS[getCategoryIconKey(category)];
  return <Icon size={size} className={className} aria-hidden="true" />;
}
