"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Plus, Edit, Trash2, MessageCircle, ShoppingBag } from "lucide-react";
import { CreateItemDialog } from "@/components/CreateItemDialog";
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
import { Magnetic } from "@/components/ui/Magnetic";


interface MarketplaceScreenProps {
  onItemClick?: (item: PostType) => void;
  onMessageSeller?: (item: PostType) => void;
}

export function MarketplaceScreen({ onItemClick, onMessageSeller }: MarketplaceScreenProps) {
  const { user } = useAuth();
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
    setEditingItem(item);
    setIsEditDialogOpen(true);
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
          .select(`*, user:users!posts_user_id_fkey(id, name, avatar_url)`)
          .eq("category", "For Sale")
          .eq("is_sold", false);

        // Apply location filters
        if (filterState) {
          query = query.eq('state', filterState);
        }
        if (filterLga) {
          query = query.eq('lga', filterLga);
        }
        if (filterWard) {
          query = query.eq('ward', filterWard);
        }

        const { data, error } = await query.order("timestamp", { ascending: false });

        if (!error) setItems(data as PostType[]);
      } finally {
        setLoading(false);
      }
    };

    fetchItems();

    const channelId = `marketplace-items-${Math.random().toString(36).substring(2, 15)}`;
    const channel = supabase
      .channel(channelId)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const newItem = payload.new as PostType;
          if (newItem.category !== "For Sale" || newItem.is_sold) return;
          setItems((prev) => [newItem, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          const updated = payload.new as PostType;
          setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        } else if (payload.eventType === "DELETE") {
          setItems((prev) => prev.filter((i) => i.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [filterState, filterLga, filterWard]);

  const filteredItems = useMemo(() => {
    let list = items;

    const activePill = CATEGORY_PILLS.find((c) => c.label === activeCategory);
    if (activePill && activePill.keywords.length > 0) {
      list = list.filter((item) => {
        const haystack = `${item.title || ""} ${item.text || ""} ${item.description || ""}`.toLowerCase();
        return activePill.keywords.some((kw) => haystack.includes(kw));
      });
    }

    if (!searchTerm) return list;
    const q = searchTerm.toLowerCase();
    return list.filter(
      (item) =>
        (item.text?.toLowerCase() || "").includes(q) ||
        (item.title?.toLowerCase() || "").includes(q) ||
        (item.description?.toLowerCase() || "").includes(q)
    );
  }, [items, searchTerm, activeCategory]);

  const formatPrice = (price: number) =>
    price === 0 ? "FREE" : `₦${price.toLocaleString()}`;

  return (
    <div className="min-h-[100dvh]" style={{ background: "var(--c-bg)" }}>
      {/* Location filter */}
      <div className="px-4 pt-4 pb-1">
        <LocationChip />
      </div>
      {/* Search bar row */}
      <div className="px-4 pt-2 pb-2">
        <div className="relative">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5"
            style={{ color: "var(--c-text-muted)" }}
          />
          <input
            type="text"
            placeholder="Search for events, items"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-2.5 bg-transparent text-foreground text-base italic font-light rounded-full outline-none placeholder:text-[#BBBBBB]"
            style={{
              border: "0.5px solid #388E3C",
              fontFamily: "var(--font-work-sans)",
              fontWeight: 300,
            }}
          />
        </div>
      </div>

      {/* Section title */}
      <div className="px-4 pt-4 pb-3">
        <h2
          className="text-lg"
          style={{ fontFamily: "var(--font-jersey25)", color: "var(--c-text)", fontWeight: 400 }}
        >
          Closest to you
        </h2>
      </div>

      {/* Category filter pills */}
      <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {CATEGORY_PILLS.map((cat) => {
          const active = activeCategory === cat.label;
          return (
            <button
              key={cat.label}
              onClick={() => setActiveCategory(cat.label)}
              className="flex-shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.97] border"
              style={{
                fontFamily: "var(--font-work-sans)",
                background: active ? "hsl(var(--primary))" : "var(--c-card)",
                color: active ? "var(--c-bg)" : "var(--c-text-muted)",
                borderColor: active ? "hsl(var(--primary))" : "var(--c-border)",
              }}
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
            <Skeleton
              key={i}
              className="h-64 w-full rounded-xl"
              style={{ background: "var(--c-card)" }}
            />
          ))}
        </div>
      ) : filteredItems.length > 0 ? (
        <div className="px-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-28">
          {filteredItems.map((item) => (
            <MarketplaceCard
              key={item.id}
              item={item}
              isOwner={!!(user && item.user_id === user.id)}
              formatPrice={formatPrice}
              onItemClick={onItemClick}
              onMessageSeller={onMessageSeller}
              onEdit={handleEditItem}
              onDelete={handleDeleteItem}
              onProfileClick={(userId) => router.push(`/profile/${userId}`)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
            style={{ background: "var(--c-card)" }}
          >
            <ShoppingBag className="w-8 h-8" style={{ color: "hsl(var(--primary))" }} />
          </div>
          <h3
            className="text-xl mb-2"
            style={{ fontFamily: "var(--font-jersey25)", color: "var(--c-text)" }}
          >
            {searchTerm ? `No results for "${searchTerm}"` : "Marketplace is empty"}
          </h3>
          <p className="text-sm" style={{ color: "var(--c-text-muted)", fontFamily: "var(--font-work-sans)" }}>
            {searchTerm
              ? "Try a different search term."
              : "Be the first to list an item in your neighborhood!"}
          </p>
        </div>
      )}

      {/* FAB — list an item */}
      <div className="fixed bottom-20 right-4 z-20 pb-[env(safe-area-inset-bottom)]">
        <button
          onClick={() => setOnboardingOpen(true)}
          className="w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          style={{ background: "hsl(var(--primary))" }}
        >
          <Plus className="w-6 h-6 text-foreground" />
        </button>
      </div>

      {/* Marketplace Creator Onboarding */}
      <MarketplaceCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onContinue={() => setIsCreateDialogOpen(true)}
      />

      {/* Create item dialog */}
      <CreateItemDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />

      {/* Edit dialog */}
      {editingItem && (
        <CreateItemDialog
          postToEdit={editingItem}
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            setIsEditDialogOpen(open);
            if (!open) setEditingItem(null);
          }}
        />
      )}
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
}: CardProps) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = !imgError && item.image_urls?.[0] ? item.image_urls[0] : null;

  return (
    <div
      className="group rounded-xl overflow-hidden flex flex-col transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-2xl cursor-pointer"
      style={{ background: "var(--c-card)" }}
    >
      {/* Image — uniform 1:1 ratio, cropped consistently */}
      <div
        className="w-full relative flex-shrink-0 overflow-hidden"
        style={{ aspectRatio: "1 / 1", background: "#1E293B" }}
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
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ShoppingBag className="w-10 h-10" style={{ color: "hsl(var(--primary))", opacity: 0.5 }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 flex flex-col gap-1 flex-1">
        {/* Item name — single line, truncated */}
        <p
          className="text-foreground text-[0.875rem] leading-[17px] truncate"
          style={{ fontFamily: "var(--font-work-sans)", fontWeight: 600 }}
          onClick={() => onItemClick?.(item)}
        >
          {item.title || item.text || "Untitled"}
        </p>

        {/* Price */}
        <p
          className="text-[1.375rem] leading-[28px] font-bold"
          style={{ fontFamily: "var(--font-work-sans)", color: "hsl(var(--primary))" }}
        >
          {formatPrice(item.price || 0)}
        </p>

        {/* Actions */}
        <div className="flex gap-1.5 mt-auto pt-1">
          {isOwner ? (
            <>
              <button
                onClick={() => onEdit(item)}
                className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: "hsl(var(--primary))",
                  color: "hsl(var(--primary))",
                  fontFamily: "var(--font-work-sans)",
                  background: "transparent",
                }}
              >
                <Edit className="w-3 h-3" />
                Edit
              </button>
              <button
                onClick={() => onDelete(item.id)}
                className="px-2.5 py-1.5 rounded-full border border-red-500 text-red-500 text-xs transition-colors hover:bg-red-500/10"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          ) : (
            <>
              <Magnetic
                onClick={() => onItemClick?.(item)}
                className="flex-1 text-xs py-1.5 rounded-full font-semibold transition-colors text-foreground justify-center"
                style={{
                  background: "hsl(var(--primary))",
                  fontFamily: "var(--font-work-sans)",
                }}
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
          className="flex items-center gap-1.5 mt-1.5 pt-1.5 w-full text-left border-t"
          style={{ borderColor: "rgba(148,163,184,0.2)" }}
          onClick={() => {
            const uid = item.user?.id || item.user_id;
            if (uid) onProfileClick(uid);
          }}
        >
          <div
            className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[0.5625rem] font-bold text-foreground overflow-hidden"
            style={{ background: "hsl(var(--primary))" }}
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
            className="text-[0.6875rem] truncate"
            style={{ color: "#94A3B8", fontFamily: "var(--font-work-sans)" }}
          >
            {item.user?.name || "Unknown Seller"}
          </span>
          <span
            className="text-[0.625rem] ml-auto flex-shrink-0"
            style={{ color: "#94A3B8", fontFamily: "var(--font-work-sans)" }}
          >
            {new Date(item.timestamp).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "short",
            })}
          </span>
        </button>
      </div>
    </div>
  );
}