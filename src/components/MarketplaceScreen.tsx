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


interface MarketplaceScreenProps {
  onItemClick?: (item: PostType) => void;
  onMessageSeller?: (item: PostType) => void;
}

export function MarketplaceScreen({ onItemClick, onMessageSeller }: MarketplaceScreenProps) {
  const { user } = useAuth();
  const { filterState, filterLga } = useLocation();
  const router = useRouter();
  const [items, setItems] = useState<PostType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingItem, setEditingItem] = useState<PostType | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const { toast } = useToast();


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

        const { data, error } = await query.order("timestamp", { ascending: false });

        if (!error) setItems(data as PostType[]);
      } finally {
        setLoading(false);
      }
    };

    fetchItems();

    const channel = supabase
      .channel("marketplace-items")
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
  }, [filterState, filterLga]);

  const filteredItems = useMemo(() => {
    if (!searchTerm) return items;
    const q = searchTerm.toLowerCase();
    return items.filter(
      (item) =>
        (item.text?.toLowerCase() || "").includes(q) ||
        (item.title?.toLowerCase() || "").includes(q) ||
        (item.description?.toLowerCase() || "").includes(q)
    );
  }, [items, searchTerm]);

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
              fontFamily: "Inter, sans-serif",
              fontWeight: 300,
            }}
          />
        </div>
      </div>

      {/* Section title */}
      <div className="px-4 pt-4 pb-3">
        <h2
          className="text-lg"
          style={{ fontFamily: "Pacifico, cursive", color: "var(--c-text)", fontWeight: 400 }}
        >
          Closest to you
        </h2>
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
            <ShoppingBag className="w-8 h-8" style={{ color: "#388E3C" }} />
          </div>
          <h3
            className="text-xl mb-2"
            style={{ fontFamily: "Pacifico, cursive", color: "var(--c-text)" }}
          >
            {searchTerm ? `No results for "${searchTerm}"` : "Marketplace is empty"}
          </h3>
          <p className="text-sm" style={{ color: "var(--c-text-muted)", fontFamily: "Inter, sans-serif" }}>
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
          style={{ background: "#388E3C" }}
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
      className="rounded-xl overflow-hidden flex flex-col transition-transform hover:scale-[1.02] hover:shadow-2xl cursor-pointer"
      style={{ background: "var(--c-card)" }}
    >
      {/* Image */}
      <div
        className="w-full relative flex-shrink-0"
        style={{ height: "150px" }}
        onClick={() => onItemClick?.(item)}
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={item.title || item.text || "Item"} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: "var(--c-card2)" }}
          >
            <ShoppingBag className="w-10 h-10" style={{ color: "#388E3C", opacity: 0.5 }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 flex flex-col gap-1 flex-1">
        {/* Item name */}
        <p
          className="text-foreground text-[0.8125rem] leading-[15px] line-clamp-2"
          style={{ fontFamily: "Inter, sans-serif", fontWeight: 500 }}
          onClick={() => onItemClick?.(item)}
        >
          {item.title || item.text || "Untitled"}
        </p>

        {/* Price */}
        <p
          className="text-[1.375rem] leading-[28px] font-bold"
          style={{ fontFamily: "Inter, sans-serif", color: "#388E3C" }}
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
                  borderColor: "#388E3C",
                  color: "#388E3C",
                  fontFamily: "Inter, sans-serif",
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
              <button
                onClick={() => onItemClick?.(item)}
                className="flex-1 text-xs py-1.5 rounded-full font-medium transition-colors text-foreground"
                style={{
                  background: "#388E3C",
                  fontFamily: "Inter, sans-serif",
                }}
              >
                {item.price === 0 ? "Claim Free" : "Buy Now"}
              </button>
              <button
                onClick={() => onMessageSeller?.(item)}
                className="px-2.5 py-1.5 rounded-full border border-[#388E3C] text-[#388E3C] transition-colors hover:bg-[#388E3C]/10"
              >
                <MessageCircle className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Seller */}
        <button
          className="flex items-center gap-1.5 mt-1 w-full text-left"
          onClick={() => {
            const uid = item.user?.id || item.user_id;
            if (uid) onProfileClick(uid);
          }}
        >
          <div
            className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[0.5625rem] font-bold text-foreground overflow-hidden"
            style={{ background: "#388E3C" }}
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
            style={{ color: "var(--c-text-muted)", fontFamily: "Inter, sans-serif" }}
          >
            {item.user?.name || "Unknown Seller"}
          </span>
          <span
            className="text-[0.625rem] ml-auto flex-shrink-0"
            style={{ color: "#555", fontFamily: "Inter, sans-serif" }}
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
