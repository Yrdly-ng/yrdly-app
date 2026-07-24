"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Search, Star, MapPin, X, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CreateBusinessDialog } from "@/components/CreateBusinessDialog";
import { BusinessCreatorOnboarding } from "@/components/BusinessCreatorOnboarding";
import type { Business } from "@/types";

const FONT = "var(--font-work-sans)";
const HEADING_FONT = "var(--font-jersey25)";

interface CategoryTile {
  name: string;
  count: number;
  image: string | null;
}

export default function BusinessesPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchBusinesses = async () => {
    try {
      const { data, error } = await supabase
        .from("businesses")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching businesses:", error);
        setBusinesses([]);
      } else {
        setBusinesses(data || []);
      }
    } catch (err) {
      console.error("Error fetching businesses:", err);
      setBusinesses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinesses();
  }, []);

  // Group businesses into category tiles, using the most recent
  // business's image in that category as the tile's cover photo.
  const categoryTiles = useMemo<CategoryTile[]>(() => {
    const map = new Map<string, CategoryTile>();

    for (const biz of businesses) {
      const name = (biz.category || "Other").trim() || "Other";
      const image = biz.cover_image || biz.image_urls?.[0] || null;

      const existing = map.get(name);
      if (existing) {
        existing.count += 1;
        if (!existing.image && image) existing.image = image;
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

  return (
    <div className="min-h-[100dvh] pb-10" style={{ background: "var(--c-bg)" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 pt-4 pb-3 backdrop-blur-md" style={{ background: "var(--c-bg)cc" }}>
        <button
          onClick={() => {
            if (showingList) {
              setActiveCategory(null);
              setSearchQuery("");
            } else {
              router.back();
            }
          }}
          className="flex items-center gap-2 text-sm mb-3 transition-opacity hover:opacity-70 text-primary-light"
          style={{ fontFamily: FONT }}
        >
          <ArrowLeft className="w-4 h-4" />
          {showingList ? "Back to categories" : "Back"}
        </button>

        <h1 className="text-3xl mb-1 text-foreground" style={{ fontFamily: HEADING_FONT }}>
          Business Hub
        </h1>
        <p className="text-sm mb-4" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
          Discover local businesses in your neighborhood
        </p>

        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search businesses"
            className="w-full h-11 pl-11 pr-10 rounded-full text-sm border border-[var(--c-border)] bg-[var(--c-card)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            style={{ fontFamily: FONT }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
          <EmptyState onAddBusiness={() => setOnboardingOpen(true)} />
        ) : showingList ? (
          <BusinessList
            businesses={visibleBusinesses}
            onOpen={(id) => router.push(`/businesses/${id}`)}
          />
        ) : (
          <CategoryGrid tiles={categoryTiles} onSelect={setActiveCategory} />
        )}
      </div>

      {/* Floating Create */}
      <div className="fixed bottom-20 right-4 z-40 lg:bottom-6">
        <Button
          size="lg"
          className="rounded-full h-12 w-12 sm:h-14 sm:w-14 shadow-lg p-0"
          style={{ background: "hsl(var(--primary))" }}
          onClick={() => setOnboardingOpen(true)}
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

      {/* Actual create form, opened after onboarding completes */}
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
          className="relative h-44 rounded-2xl overflow-hidden group text-left"
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
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
              className="w-full h-full"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--primary)) 0%, rgba(56,142,60,0.6) 100%)",
              }}
            />
          )}

          {/* Gradient overlay for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />

          {/* Count badge */}
          <span className="absolute top-2.5 right-2.5 bg-white/90 text-[hsl(var(--primary))] text-xs px-2 py-0.5 rounded-full font-semibold">
            {tile.count}
          </span>

          {/* Title */}
          <span
            className="absolute bottom-3 left-3.5 right-3.5 text-white font-semibold text-base leading-tight"
            style={{ fontFamily: FONT }}
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
        <p className="text-sm text-muted-foreground" style={{ fontFamily: FONT }}>
          No businesses found
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-2">
      {businesses.map((biz) => (
        <button
          key={biz.id}
          onClick={() => onOpen(biz.id)}
          className="w-full flex items-center gap-3 p-3 rounded-2xl border border-[var(--c-border)] bg-[var(--c-card)] text-left transition-shadow hover:shadow-md"
        >
          <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-[var(--c-card2)]">
            <Image
              src={biz.logo || biz.cover_image || biz.image_urls?.[0] || "/placeholder.svg"}
              alt={biz.name}
              width={64}
              height={64}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate" style={{ fontFamily: FONT }}>
              {biz.name}
            </h3>
            <p className="text-xs text-muted-foreground truncate" style={{ fontFamily: FONT }}>
              {biz.category}
            </p>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                <span className="text-xs font-medium text-foreground">
                  {biz.rating?.toFixed(1) || "0.0"}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({biz.review_count || 0})
                </span>
              </div>
              {biz.distance && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="text-xs">{biz.distance}</span>
                </div>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function EmptyState({ onAddBusiness }: { onAddBusiness: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-6">
      <h2 className="text-lg font-semibold text-foreground mb-1" style={{ fontFamily: FONT }}>
        No businesses yet
      </h2>
      <p className="text-sm text-muted-foreground max-w-xs mb-5" style={{ fontFamily: FONT }}>
        Local businesses in your neighborhood will show up here once they join Yrdly.
      </p>
      <button
        onClick={onAddBusiness}
        className="flex items-center gap-2 h-11 px-5 rounded-full font-sans font-semibold text-sm text-foreground transition-all active:scale-95"
        style={{ background: "hsl(var(--primary))" }}
      >
        <Plus className="w-4 h-4" />
        Add Business
      </button>
    </div>
  );
}