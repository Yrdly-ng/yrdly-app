"use client";
import { useState, useEffect, useMemo } from "react";
import { Search, Plus, Edit, Trash2, MessageCircle, ShoppingBag, BadgeCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Post as PostType } from "@/types";
import Image from "next/image";
import { useLocation } from "@/contexts/LocationContext";
import { LocationChip } from "@/components/LocationChip";
import { MarketplaceCreatorOnboarding } from "@/components/marketplace/MarketplaceCreatorOnboarding";
import { MarketplaceItemCard } from "@/components/MarketplaceItemCard";
import { Magnetic } from "@/components/ui/Magnetic";
import { GlassCard } from "@/components/ui/glass-card";

interface MarketplaceScreenProps {
  onItemClick?: (item: PostType) => void;
  onMessageSeller?: (item: PostType) => void;
}

export function MarketplaceScreen({ onItemClick, onMessageSeller }: MarketplaceScreenProps) {
  const { user, profile } = useAuth();
  const { activeFilter } = useLocation();
  const filterState = activeFilter?.state;
  const filterLga = activeFilter?.lga;
  const filterWard = activeFilter?.ward;
  const router = useRouter();
  const [items, setItems] = useState<PostType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingItem, setEditingItem] = useState<PostType | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("All Items");
  const { toast } = useToast();

  const CATEGORY_PILLS: { label: string; emoji: string; keywords: string[] }[] = [
    { label: "All Items", emoji: "🗂️", keywords: [] },
    { label: "Phones", emoji: "📱", keywords: ["phone", "iphone", "samsung", "android", "smartphone"] },
    { label: "Accessories", emoji: "🎧", keywords: ["accessor", "case", "charger", "headphone", "earbud", "cable"] },
    { label: "Health & Beauty", emoji: "🌿", keywords: ["health", "beauty", "skincare", "cosmetic", "primrose", "oil", "cream"] },
    { label: "Electronics", emoji: "💻", keywords: ["electronic", "laptop", "tv", "television", "computer", "gadget", "console"] },
  ];

  const handleEditItem = (item: PostType) => {
    router.push(`/marketplace/edit/${item.id}`);
  };

  const handleCreateItem = () => {
    if (!profile?.phone_verified) {
      router.push("/verify-phone");
      return;
    }
    if ((profile as any)?.onboarded_marketplace) {
      router.push("/marketplace/create");
    } else {
      setOnboardingOpen(true);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from("posts")
        .delete()
        .eq("id", itemId)
        .eq("user_id", user.id);

      if (error) {
        toast({ variant: "destructive", title: "Error", description: "Failed to delete item." });
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      toast({ title: "Item Deleted", description: "Your item has been deleted successfully." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete item." });
    }
  };

  useEffect(() => {
    const fetchItems = async () => {
      try {
        let query = supabase
          .from("posts")
          .select(`*, user:users!posts_user_id_fkey(id, name, avatar_url, verified_seller)`)
          .eq("category", "For Sale")
          .eq("is_sold", false);

        if (filterState) {
          query = query.eq('state', filterState);
        }
        if (filterLga) {
          query = query.eq('lga', filterLga);
        }
        if (filterWard) {
          query = query.eq('ward', filterWard);
        }

        const { data, error } = await query.order("created_at", { ascending: false });

        if (error) {
          console.error("Error fetching items:", error);
          toast({ variant: "destructive", title: "Error", description: "Failed to load marketplace items." });
        } else {
          setItems(data || []);
        }
      } catch (error) {
        console.error("Error in fetchItems:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchItems();
  }, [filterState, filterLga, filterWard, toast]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const title = item.title || item.text || "";
      const matchesSearch = title.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (activeCategory === "All Items") return true;
      const pill = CATEGORY_PILLS.find((p) => p.label === activeCategory);
      if (!pill || pill.keywords.length === 0) return true;
      return pill.keywords.some((kw) => title.toLowerCase().includes(kw));
    });
  }, [items, searchTerm, activeCategory]);

  return (
    <div className="max-w-4xl mx-auto space-y-4 font-yrdly-body pb-20 sm:pb-8">
      {/* Header bar */}
      <div className="px-4 flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold font-yrdly-display text-foreground">
          Marketplace
        </h1>
        <div className="flex items-center gap-2">
          <LocationChip />
          <Magnetic
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-primary-foreground font-yrdly-display transition-all duration-150 active:scale-[0.97]"
            style={{ background: "hsl(var(--primary))" }}
            onClick={handleCreateItem}
          >
            <Plus className="w-4 h-4" />
            Sell Item
          </Magnetic>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-4">
        <GlassCard className="rounded-full p-0">
          <div className="flex items-center px-3 py-1.5 gap-2">
            <Search className="w-4 h-4 text-[var(--yrdly-label)] flex-shrink-0" />
            <input
              type="text"
              placeholder="Search items, phones, laptops..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent text-xs text-foreground placeholder-[var(--yrdly-label)] focus:outline-none font-yrdly-body"
            />
          </div>
        </GlassCard>
      </div>

      {/* Category filter pills */}
      <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {CATEGORY_PILLS.map((cat) => {
          const active = activeCategory === cat.label;
          return (
            <button
              key={cat.label}
              onClick={() => setActiveCategory(cat.label)}
              className={`flex-shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold font-yrdly-body transition-all duration-150 active:scale-[0.97] border ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-[var(--yrdly-glass-bg)] text-[var(--yrdly-label)] border-[var(--yrdly-glass-border)]"
              }`}
            >
              <span>{cat.emoji}</span>
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Items grid */}
      {loading ? (
        <div className="px-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-28">
          {[...Array(8)].map((_, i) => (
            <GlassCard key={i} className="h-64 w-full rounded-xl">
              <Skeleton className="h-full w-full rounded-lg" />
            </GlassCard>
          ))}
        </div>
      ) : filteredItems.length > 0 ? (
        <div className="px-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-28">
          {filteredItems.map((item) => (
            <MarketplaceItemCard
              key={item.id}
              item={item}
              onPress={() => (onItemClick ? onItemClick(item) : router.push(`/marketplace/${item.id}`))}
              onMessageSeller={onMessageSeller}
            />
          ))}
        </div>
      ) : (
        <GlassCard className="flex flex-col items-center justify-center py-24 mx-4 px-4 text-center rounded-3xl">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-primary/10"
          >
            <ShoppingBag className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl mb-2 font-bold font-yrdly-display text-foreground">
            {searchTerm ? `No results for "${searchTerm}"` : "Marketplace is empty"}
          </h3>
          <p className="text-sm text-[var(--yrdly-label)] font-yrdly-body">
            {searchTerm
              ? "Try a different search term."
              : "Be the first to list an item in your neighborhood!"}
          </p>
        </GlassCard>
      )}



      {/* Marketplace Creator Onboarding */}
      <MarketplaceCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onContinue={() => router.push("/marketplace/create")}
      />
    </div>
  );
}

/* ─── Card component ──────────────────────────────────────────── */
interface CardProps {
  item: PostType;
  isOwner: boolean;
  formatPrice: (p: number) => string;
  onItemClick?: (item: PostType) => void;
  onMessageSeller?: (item: PostType) => void;
  onEdit: (item: PostType) => void;
  onDelete: (id: string) => void;
  onProfileClick: (userId: string) => void;
  priority?: boolean;
}

function MarketplaceCard({
  item,
  isOwner,
  formatPrice,
  onItemClick,
  onMessageSeller,
  onEdit,
  onDelete,
  onProfileClick,
  priority,
}: CardProps) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = !imgError && item.image_urls?.[0] ? item.image_urls[0] : null;

  return (
    <GlassCard
      className="group rounded-xl overflow-hidden flex flex-col transition-transform duration-300 hover:-translate-y-0.5 cursor-pointer p-0"
    >
      {/* Image — uniform 1:1 ratio, cropped consistently */}
      <div
        className="w-full relative flex-shrink-0 overflow-hidden bg-[var(--yrdly-dark)]"
        style={{ aspectRatio: "1 / 1" }}
        onClick={() => onItemClick?.(item)}
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={item.title || item.text || "Item"}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
            priority={priority}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ShoppingBag className="w-10 h-10 text-primary/50" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 flex flex-col gap-1 flex-1 font-yrdly-body">
        {/* Item name — single line, truncated */}
        <p
          className="text-foreground text-[0.875rem] leading-[17px] truncate font-yrdly-display font-semibold"
          onClick={() => onItemClick?.(item)}
        >
          {item.title || item.text || "Untitled"}
        </p>

        {/* Price */}
        <p
          className="text-[1.375rem] leading-[28px] font-bold text-primary font-yrdly-display"
        >
          {formatPrice(item.price || 0)}
        </p>

        {/* Actions */}
        <div className="flex gap-1.5 mt-auto pt-1">
          {isOwner ? (
            <>
              <button
                onClick={() => onEdit(item)}
                className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-full border border-primary text-primary font-yrdly-body bg-transparent transition-colors"
              >
                <Edit className="w-3 h-3" />
                Edit
              </button>
              <button
                onClick={() => onDelete(item.id)}
                className="px-2.5 py-1.5 rounded-full border border-red-500 text-red-500 text-xs transition-colors hover:bg-red-500/10 font-yrdly-body"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          ) : (
            <>
              <Magnetic
                onClick={() => onItemClick?.(item)}
                className="flex-1 text-xs py-1.5 rounded-full font-semibold transition-colors bg-primary text-primary-foreground justify-center font-yrdly-body"
                strength={4}
              >
                {item.price === 0 ? "Claim Free" : "Buy Now"}
              </Magnetic>
              <button
                onClick={() => onMessageSeller?.(item)}
                className="px-2.5 py-1.5 rounded-full border border-primary text-primary transition-colors hover:bg-primary/10"
                aria-label="Message seller"
              >
                <MessageCircle className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Seller — dedicated top border + lighter text for legibility */}
        <button
          className="flex items-center gap-1.5 mt-1.5 pt-1.5 w-full text-left border-t border-[var(--yrdly-glass-border)]"
          onClick={() => {
            const uid = item.user?.id || item.user_id;
            if (uid) onProfileClick(uid);
          }}
        >
          <div
            className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[0.5625rem] font-bold text-black font-yrdly-body overflow-hidden bg-primary"
          >
            {item.user?.avatar_url ? (
              <Image
                src={item.user.avatar_url}
                alt={item.user.name || ""}
                width={16}
                height={16}
                className="object-cover w-full h-full rounded-full"
              />
            ) : (
              (item.user?.name?.slice(0, 2) || "U").toUpperCase()
            )}
          </div>
          <span
            className="text-[0.6875rem] truncate flex items-center gap-1 text-[var(--yrdly-label)] font-yrdly-body"
          >
            {item.user?.name || "Unknown Seller"}
            {item.user?.verified_seller && (
              <BadgeCheck className="w-3.5 h-3.5 text-[#82DB7E] fill-[#82DB7E]/20 shrink-0" />
            )}
          </span>
          <span
            className="text-[0.625rem] ml-auto flex-shrink-0 text-[var(--yrdly-label)] font-yrdly-body"
          >
            {new Date(item.timestamp).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "short",
            })}
          </span>
        </button>
      </div>
    </GlassCard>
  );
}