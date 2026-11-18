"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin, Navigation, Plus, Search, ShoppingBag, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase/supabase";
import type { Post } from "@/types/index";
import { useLocation } from "@/contexts/LocationContext";
import { LocationChip } from "@/components/location/LocationChip";
import { MarketplaceCreatorOnboarding } from "./MarketplaceCreatorOnboarding";
import { MarketplaceItemCard } from "./MarketplaceItemCard";
import { CategoryIcon } from "@/components/discovery/CategoryIcon";
import {
  discoverListings,
  MARKETPLACE_BUDGETS,
  MARKETPLACE_CATEGORIES,
  type MarketplaceBudget,
  type MarketplaceSort,
} from "@/lib/marketplace/discovery";

interface MarketplaceScreenProps {
  onItemClick?: (item: Post) => void;
  onMessageSeller?: (item: Post) => void;
}

const pillClass =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const gridClass =
  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,8rem),1fr))] gap-3 min-[390px]:gap-4 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]";

export function MarketplaceScreen({
  onItemClick,
  onMessageSeller,
}: MarketplaceScreenProps) {
  const { profile } = useAuth();
  const { activeFilter, userProfileLocation, setGlobalFilter, displayLabel } =
    useLocation();
  const filterState = activeFilter?.state;
  const filterLga = activeFilter?.lga;
  const filterWard = activeFilter?.ward;
  const router = useRouter();
  const [items, setItems] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("All Items");
  const [budget, setBudget] = useState<MarketplaceBudget>("all");
  const [sort, setSort] = useState<MarketplaceSort>("newest");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const nearHome =
    !!userProfileLocation?.state &&
    !!userProfileLocation?.lga &&
    filterState === userProfileLocation.state &&
    filterLga === userProfileLocation.lga &&
    !filterWard;
  const hasFilters =
    !!searchTerm || activeCategory !== "All Items" || budget !== "all";

  const handleCreateItem = () => {
    if (!profile?.phone_verified) {
      router.push("/verify-phone");
    } else if (
      (profile as typeof profile & { onboarded_marketplace?: boolean })
        ?.onboarded_marketplace
    ) {
      router.push("/marketplace/create");
    } else {
      setOnboardingOpen(true);
    }
  };

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(false);
    const fetchItems = async () => {
      try {
        let query = supabase
          .from("posts")
          .select(
            "*, user:public_profiles!posts_user_id_fkey(id, name, avatar_url, phone_verified)",
          )
          .eq("category", "For Sale")
          .eq("is_sold", false);
        if (filterState) query = query.eq("state", filterState);
        if (filterLga) query = query.eq("lga", filterLga);
        if (filterWard) query = query.eq("ward", filterWard);
        const { data, error } = await query.order("created_at", {
          ascending: false,
        });
        if (error) throw error;
        if (current) setItems(data || []);
      } catch {
        if (current) {
          setItems([]);
          setLoadError(true);
        }
      } finally {
        if (current) setLoading(false);
      }
    };
    void fetchItems();
    return () => {
      current = false;
    };
  }, [filterState, filterLga, filterWard, retry]);

  const filteredItems = useMemo(
    () =>
      discoverListings(items, {
        search: searchTerm,
        category: activeCategory,
        budget,
        sort,
      }),
    [items, searchTerm, activeCategory, budget, sort],
  );

  const resetFilters = () => {
    setSearchTerm("");
    setActiveCategory("All Items");
    setBudget("all");
    setSort("newest");
  };

  return (
    <div className="w-full space-y-5 px-3 pb-20 pt-2 font-yrdly-body min-[390px]:px-4 sm:pb-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[min(100%,8rem)] flex-1">
            <h1 className="text-xl font-bold font-yrdly-display text-foreground sm:text-2xl">
              Buy & sell nearby
            </h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Good finds from your neighbourhood.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCreateItem}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Sell item
          </button>
        </div>
        <div
          role="search"
          aria-label="Marketplace"
          className="flex min-h-14 items-center gap-2 rounded-2xl border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-primary"
        >
          <Search
            className="h-5 w-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor="marketplace-search" className="sr-only">
            Search marketplace
          </label>
          <input
            id="marketplace-search"
            type="search"
            placeholder="What are you looking for?"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="min-h-12 w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
          />
          {searchTerm && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearchTerm("");
                document.getElementById("marketplace-search")?.focus();
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 [&_button]:min-h-11 [&_button]:text-sm">
          <LocationChip />
          {userProfileLocation?.state && userProfileLocation?.lga && (
            <button
              type="button"
              aria-pressed={nearHome}
              onClick={() =>
                setGlobalFilter({
                  state: userProfileLocation.state,
                  lga: userProfileLocation.lga,
                })
              }
              className={`${pillClass} ${nearHome ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground"}`}
            >
              <Navigation className="h-4 w-4" aria-hidden="true" /> Near me
            </button>
          )}
        </div>
      </header>

      <div className="space-y-3">
        <div
          role="group"
          aria-label="Listing categories"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {MARKETPLACE_CATEGORIES.map((category) => (
            <button
              key={category.label}
              type="button"
              aria-pressed={activeCategory === category.label}
              onClick={() => setActiveCategory(category.label)}
              className={`${pillClass} ${activeCategory === category.label ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-primary/50"}`}
            >
              <CategoryIcon
                category={category.label}
                size={18}
                className="shrink-0"
              />
              {category.label}
            </button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Listing budget"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {MARKETPLACE_BUDGETS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={budget === option.value}
              onClick={() => setBudget(option.value)}
              className={`${pillClass} ${budget === option.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:border-primary/50"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <section
        aria-label="Marketplace listings"
        aria-busy={loading}
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p role="status" className="text-sm font-semibold text-foreground">
              {loading
                ? "Finding listings…"
                : loadError
                  ? "Listings unavailable"
                  : `${filteredItems.length} ${filteredItems.length === 1 ? "listing" : "listings"}`}
            </p>
            <p className="mt-1 flex items-start gap-1 text-xs leading-5 text-muted-foreground">
              <MapPin
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{displayLabel}</span>
            </p>
          </div>
          <div className="flex min-h-11 items-center gap-1 text-sm">
            <label htmlFor="marketplace-sort" className="sr-only">
              Sort listings
            </label>
            <select
              id="marketplace-sort"
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as MarketplaceSort)
              }
              className="min-h-11 max-w-full rounded-xl border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="newest">Newest first</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
            </select>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="min-h-11 rounded-lg px-2 text-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Clear filters
            </button>
          )}
        </div>
        {loading ? (
          <div className={gridClass}>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton
                key={index}
                className="aspect-[3/5] w-full rounded-2xl"
              />
            ))}
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="rounded-2xl border border-border bg-card px-5 py-10 text-center"
          >
            <h2 className="text-lg font-semibold text-foreground">
              Couldn’t load listings
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
              className="mt-4 min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Try again
            </button>
          </div>
        ) : filteredItems.length ? (
          <div className={gridClass}>
            {filteredItems.map((item) => (
              <MarketplaceItemCard
                key={item.id}
                item={item}
                onPress={onItemClick ? () => onItemClick(item) : undefined}
                onMessageSeller={onMessageSeller}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center">
            <ShoppingBag
              className="mx-auto h-10 w-10 text-primary"
              aria-hidden="true"
            />
            <h2 className="mt-4 break-words text-lg font-semibold text-foreground">
              {hasFilters
                ? "No matching listings"
                : "No listings in this area yet"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {hasFilters
                ? "Try another search, category or budget. You can also change your location above."
                : "Choose another location above, or list something your neighbours might love."}
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 min-h-11 rounded-full border border-border px-5 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Show all listings
              </button>
            )}
          </div>
        )}
      </section>
      <MarketplaceCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onContinue={() => router.push("/marketplace/create")}
      />
    </div>
  );
}
