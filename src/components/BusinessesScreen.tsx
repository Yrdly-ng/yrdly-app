"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Search, Star, MapPin, X, Plus, BadgeCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CreateBusinessDialog } from "@/components/CreateBusinessDialog";
import { BusinessCreatorOnboarding } from "@/components/BusinessCreatorOnboarding";
import { useLocation } from "@/contexts/LocationContext";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { Business } from "@/types";

import { GlassCard } from "@/components/ui/glass-card";

/* Category name -> representative image. Matches by keyword so both the
   fixed CreateBusinessDialog list and any legacy/free-typed categories
   (e.g. "cafe") resolve to something sensible instead of a random
   business's own photo. */
const CATEGORY_IMAGE_RULES: { keywords: string[]; image: string }[] = [
  { keywords: ["food", "drink", "cafe", "coffee", "restaurant", "bakery", "kitchen"], image: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&q=80&auto=format&fit=crop" },
  { keywords: ["retail", "shop", "store", "market"], image: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80&auto=format&fit=crop" },
  { keywords: ["service"], image: "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800&q=80&auto=format&fit=crop" },
  { keywords: ["tech", "electronics", "gadget", "computer"], image: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80&auto=format&fit=crop" },
  { keywords: ["health", "fitness", "gym", "wellness", "clinic", "pharmacy"], image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80&auto=format&fit=crop" },
  { keywords: ["fashion", "apparel", "clothing", "wear"], image: "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&q=80&auto=format&fit=crop" },
  { keywords: ["beauty", "salon", "spa", "cosmetic", "hair", "makeup"], image: "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=800&q=80&auto=format&fit=crop" },
  { keywords: ["entertainment", "event", "music", "game", "sport"], image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80&auto=format&fit=crop" },
];

const OTHER_CATEGORY_IMAGE = "/categories/other.svg";

function getCategoryImage(category: string): string {
  const normalized = category.toLowerCase();
  const match = CATEGORY_IMAGE_RULES.find((rule) =>
    rule.keywords.some((keyword) => normalized.includes(keyword))
  );
  return match ? match.image : OTHER_CATEGORY_IMAGE;
}

interface CategoryTile {
  name: string;
  count: number;
  image: string | null;
}

export function BusinessesScreen({ backTarget = "/businesses" }: { backTarget?: string }) {
  const router = useRouter();
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const activeCategory = searchParams.get("category") || null;

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { activeFilter } = useLocation();
  const filterState = activeFilter?.state;
  const filterLga = activeFilter?.lga;
  const filterWard = activeFilter?.ward;

  const fetchBusinesses = async () => {
    try {
      let query = supabase
        .from("businesses")
        .select("*")
        .order("created_at", { ascending: false });

      if (filterState) query = query.eq("state", filterState);
      if (filterLga) query = query.eq("lga", filterLga);
      if (filterWard) query = query.eq("ward", filterWard);

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching businesses:", error);
        setBusinesses([]);
        return;
      }

      const list: Business[] = data || [];

      if (list.length > 0) {
        const { data: reviewRows, error: reviewsError } = await supabase
          .from("business_reviews")
          .select("business_id, rating")
          .in("business_id", list.map((b) => b.id));

        if (!reviewsError && reviewRows) {
          const stats = new Map<string, { total: number; count: number }>();
          for (const row of reviewRows) {
            const entry = stats.get(row.business_id) || { total: 0, count: 0 };
            entry.total += row.rating || 0;
            entry.count += 1;
            stats.set(row.business_id, entry);
          }
          for (const biz of list) {
            const entry = stats.get(biz.id);
            biz.rating = entry ? entry.total / entry.count : 0;
            biz.review_count = entry ? entry.count : 0;
          }
        }
      }

      setBusinesses(list);
    } catch (err) {
      console.error("Error fetching businesses:", err);
      setBusinesses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinesses();
  }, [filterState, filterLga, filterWard]);

  // Group businesses into category tiles
  const categoryTiles = useMemo<CategoryTile[]>(() => {
    const map = new Map<string, CategoryTile>();

    for (const biz of businesses) {
      const name = (biz.category || "Other").trim() || "Other";
      const image = getCategoryImage(name);

      const existing = map.get(name);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(name, { name, count: 1, image });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [businesses]);

  // Businesses to show once a category is selected, or while searching.
  const visibleBusinesses = useMemo(() => {
    let list = businesses;

    if (activeCategory) {
      list = list.filter((b) => (b.category || "Other").trim() === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (b) =>
          b.name?.toLowerCase().includes(q) ||
          b.category?.toLowerCase().includes(q) ||
          b.description?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [businesses, activeCategory, searchQuery]);

  const showingList = activeCategory !== null || searchQuery.trim().length > 0;

  const buildHref = (extra: string) =>
    backTarget.includes("?") ? `${backTarget}&${extra}` : `${backTarget}?${extra}`;

  const handleSelectCategory = (cat: string) => {
    router.push(buildHref(`category=${encodeURIComponent(cat)}`));
  };

  const handleClearCategory = () => {
    setSearchQuery("");
    router.push(backTarget);
  };

  const handleCreateBusiness = () => {
    if (!profile?.phone_verified) {
      router.push("/verify-phone");
      return;
    }
    setOnboardingOpen(true);
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body pb-10">
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 pt-4 pb-3 bg-[var(--yrdly-dark)]/80 backdrop-blur-md border-b border-[var(--yrdly-glass-border)]">
        {showingList && (
          <button
            onClick={handleClearCategory}
            className="flex items-center gap-2 text-sm mb-3 transition-opacity hover:opacity-70 text-primary font-yrdly-body"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to categories
          </button>
        )}

        <h1 className="text-3xl mb-1 text-foreground font-yrdly-display font-bold">
          Business Hub
        </h1>
        <p className="text-sm mb-4 text-[var(--yrdly-label)] font-yrdly-body">
          Discover local businesses in your neighborhood
        </p>

        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--yrdly-label)]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search businesses"
            className="w-full h-11 pl-11 pr-10 rounded-full text-sm border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] text-foreground placeholder:text-[var(--yrdly-label)] font-yrdly-body focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--yrdly-label)] hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="px-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3.5 mt-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-44 w-full rounded-2xl" />
            ))}
          </div>
        ) : businesses.length === 0 ? (
          <EmptyState onAddBusiness={handleCreateBusiness} />
        ) : showingList ? (
          <BusinessList
            businesses={visibleBusinesses}
            onOpen={(id) => router.push(`/businesses/${id}`)}
          />
        ) : (
          <CategoryGrid tiles={categoryTiles} onSelect={handleSelectCategory} />
        )}
      </div>

      {/* Floating Create */}
      <div className="fixed bottom-20 right-4 z-40 lg:bottom-6">
        <Button
          size="lg"
          className="rounded-full h-12 w-12 sm:h-14 sm:w-14 shadow-lg p-0 bg-primary"
          onClick={handleCreateBusiness}
        >
          <Plus className="h-6 w-6 text-foreground" />
        </Button>
      </div>

      {/* Business Creator Onboarding */}
      <BusinessCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onContinue={() => setCreateOpen(true)}
      />

      {/* Actual create form */}
      <CreateBusinessDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => fetchBusinesses()}
      />
    </div>
  );
}

function CategoryGrid({
  tiles,
  onSelect,
}: {
  tiles: CategoryTile[];
  onSelect: (category: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3.5 mt-2">
      {tiles.map((tile) => (
        <button
          key={tile.name}
          onClick={() => onSelect(tile.name)}
          className="relative h-44 rounded-2xl overflow-hidden group text-left border border-[var(--yrdly-glass-border)] shadow-sm"
        >
          {tile.image ? (
            <Image
              src={tile.image}
              alt={tile.name}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div
              className="w-full h-full bg-primary/20"
            />
          )}

          {/* Gradient overlay for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />

          {/* Count badge */}
          <span className="absolute top-2.5 right-2.5 bg-black/60 backdrop-blur-md text-primary text-xs px-2 py-0.5 rounded-full font-bold font-yrdly-display border border-[var(--yrdly-glass-border)]">
            {tile.count}
          </span>

          {/* Title */}
          <span
            className="absolute bottom-3 left-3.5 right-3.5 text-white font-bold text-base leading-tight font-yrdly-display"
          >
            {tile.name}
          </span>
        </button>
      ))}
    </div>
  );
}

function BusinessList({
  businesses,
  onOpen,
}: {
  businesses: Business[];
  onOpen: (id: string) => void;
}) {
  if (businesses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-[var(--yrdly-label)] font-yrdly-body">
          No businesses found
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-2">
      {businesses.map((biz) => (
        <GlassCard
          key={biz.id}
          onClick={() => onOpen(biz.id)}
          className="w-full flex items-center gap-3 p-3 rounded-2xl cursor-pointer text-left transition-all hover:scale-[1.01]"
        >
          <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)]">
            <Image
              src={biz.logo || biz.cover_image || biz.image_urls?.[0] || "/placeholder.svg"}
              alt={biz.name}
              width={64}
              height={64}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <h3 className="font-bold text-foreground truncate font-yrdly-display">
                {biz.name}
              </h3>
              {biz.verified_seller && (
                <BadgeCheck className="w-4 h-4 text-[#82DB7E] fill-[#82DB7E]/20 shrink-0" />
              )}
            </div>
            <p className="text-xs text-[var(--yrdly-label)] truncate font-yrdly-body">
              {biz.category}
            </p>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                <span className="text-xs font-medium text-foreground font-yrdly-body">
                  {biz.rating?.toFixed(1) || "0.0"}
                </span>
                <span className="text-xs text-[var(--yrdly-label)] font-yrdly-body">
                  ({biz.review_count || 0})
                </span>
              </div>
              {biz.distance && (
                <div className="flex items-center gap-1 text-[var(--yrdly-label)] font-yrdly-body">
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="text-xs">{biz.distance}</span>
                </div>
              )}
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function EmptyState({ onAddBusiness }: { onAddBusiness: () => void }) {
  return (
    <GlassCard className="flex flex-col items-center justify-center py-24 text-center px-6 rounded-3xl mt-4">
      <h2 className="text-lg font-bold text-foreground mb-1 font-yrdly-display">
        No businesses yet
      </h2>
      <p className="text-sm text-[var(--yrdly-label)] max-w-xs mb-5 font-yrdly-body">
        Local businesses in your neighborhood will show up here once they join Yrdly.
      </p>
      <button
        onClick={onAddBusiness}
        className="flex items-center gap-2 h-11 px-5 rounded-full font-yrdly-body font-semibold text-sm text-foreground bg-primary transition-all active:scale-95"
      >
        <Plus className="w-4 h-4" />
        Add Business
      </button>
    </GlassCard>
  );
}
