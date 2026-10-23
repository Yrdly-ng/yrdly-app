"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  MapPin,
  Plus,
  Search,
  Star,
  Store,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase/supabase";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateBusinessDialog } from "./CreateBusinessDialog";
import { BusinessCreatorOnboarding } from "./BusinessCreatorOnboarding";
import { useLocation } from "@/contexts/LocationContext";
import { useAuth } from "@/hooks/use-supabase-auth";
import {
  getBusinessLocation,
  getBusinessModeLabel,
  getBusinessRating,
} from "@/lib/businesses/presentation";
import type { Business } from "@/types";

export function BusinessesScreen({
  backTarget = "/businesses",
}: {
  backTarget?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const { activeFilter } = useLocation();
  const category = searchParams.get("category") || null;
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const revision = useRef(0);
  const state = activeFilter?.state;
  const lga = activeFilter?.lga;
  const ward = activeFilter?.ward;
  const fetchBusinesses = useCallback(async () => {
    const request = ++revision.current;
    setError("");
    try {
      let requestQuery = supabase
        .from("businesses")
        .select("*")
        .eq("is_active", true)
        .eq("moderation_status", "approved")
        .order("created_at", { ascending: false });
      if (state) requestQuery = requestQuery.eq("state", state);
      if (lga) requestQuery = requestQuery.eq("lga", lga);
      if (ward) requestQuery = requestQuery.eq("ward", ward);
      const result = await requestQuery;
      if (result.error) throw result.error;
      if (request === revision.current) setBusinesses(result.data || []);
    } catch (cause) {
      if (request === revision.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "We couldn't load local businesses. Please try again.",
        );
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [state, lga, ward]);
  useEffect(() => {
    setLoading(true);
    setBusinesses([]);
    void fetchBusinesses();
    const refresh = () => void fetchBusinesses();
    const channel = supabase
      .channel(
        `business-directory-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "businesses" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "business_reviews" },
        refresh,
      )
      .subscribe();
    window.addEventListener("focus", refresh);
    return () => {
      revision.current++;
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [fetchBusinesses]);
  const categories = useMemo(
    () =>
      Array.from(
        new Set(businesses.map((item) => item.category?.trim() || "Other")),
      ).sort(),
    [businesses],
  );
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return businesses.filter(
      (item) =>
        (!category || (item.category?.trim() || "Other") === category) &&
        (!search ||
          [item.name, item.category, item.description].some((value) =>
            value?.toLowerCase().includes(search),
          )),
    );
  }, [businesses, category, query]);
  const selectCategory = (value: string | null) =>
    router.push(
      value
        ? `${backTarget}${backTarget.includes("?") ? "&" : "?"}category=${encodeURIComponent(value)}`
        : backTarget,
    );
  const create = () => {
    if (!profile?.phone_verified) {
      router.push("/verify-phone");
      return;
    }
    setOnboardingOpen(true);
  };

  return (
    <section className="mx-auto max-w-6xl space-y-7 px-4 py-6 pb-24 font-yrdly-body text-foreground sm:px-6 sm:py-8">
      <header className="space-y-6">
        {backTarget === "/businesses" && (
          <button
            onClick={() => router.push("/explore")}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={17} /> Explore
          </button>
        )}
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Good people. Great local finds.
            </p>
            <h1 className="font-yrdly-display text-4xl font-bold tracking-tight sm:text-5xl">
              Your local directory<span className="text-primary">.</span>
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
              Find the shops, services and people worth knowing in your
              neighbourhood.
            </p>
          </div>
          <Button
            onClick={create}
            className="h-12 rounded-2xl px-5 font-semibold"
          >
            <Plus size={18} className="mr-2" /> Add your business
          </Button>
        </div>
        <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="relative flex-1">
            <Search
              size={19}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              aria-label="Search businesses"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="A shop, a service, something nearby…"
              className="h-12 w-full rounded-2xl border border-border bg-background pl-12 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {query && (
              <button
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-xl"
              >
                <X size={17} />
              </button>
            )}
          </div>
          <p className="inline-flex items-center gap-2 px-2 text-sm text-muted-foreground">
            <MapPin size={17} className="shrink-0 text-primary" />
            {[ward, lga, state].filter(Boolean).join(", ") || "Across Nigeria"}
          </p>
        </div>
      </header>
      {!!categories.length && (
        <nav
          aria-label="Business categories"
          className="flex gap-2 overflow-x-auto pb-2"
        >
          <button
            onClick={() => selectCategory(null)}
            aria-pressed={!category}
            className={`min-h-11 shrink-0 rounded-full border px-5 text-sm font-semibold ${!category ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}
          >
            All businesses
          </button>
          {categories.map((item) => (
            <button
              key={item}
              onClick={() => selectCategory(item)}
              aria-pressed={category === item}
              className={`min-h-11 shrink-0 rounded-full border px-5 text-sm font-semibold ${category === item ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}
            >
              {item}
            </button>
          ))}
        </nav>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p>{error}</p>
          <Button variant="outline" onClick={() => void fetchBusinesses()}>
            Try again
          </Button>
        </div>
      )}
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-yrdly-display text-2xl font-bold">
          {category ||
            (query ? "Search results" : "Discover your next favourite")}
        </h2>
        {!loading && !error && (
          <p className="text-sm text-muted-foreground">
            {visible.length} {visible.length === 1 ? "business" : "businesses"}
          </p>
        )}
      </div>
      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-80 rounded-3xl" />
          ))}
        </div>
      ) : visible.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((business) => (
            <BusinessDirectoryCard
              key={business.id}
              business={business}
              onOpen={() => router.push(`/businesses/${business.id}`)}
            />
          ))}
        </div>
      ) : (
        !error && (
          <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <Store size={30} className="mx-auto mb-4 text-primary" />
            <h3 className="font-yrdly-display text-2xl font-bold">
              {query || category
                ? "No matches just yet"
                : "Make the first local connection"}
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {query || category
                ? "Try another search or browse all local businesses."
                : "Businesses in this area will appear here. Have one of your own? Give it a home on Yrdly."}
            </p>
            <Button
              variant="outline"
              className="mt-5 rounded-xl"
              onClick={
                query || category
                  ? () => {
                      setQuery("");
                      selectCategory(null);
                    }
                  : create
              }
            >
              {query || category ? "Clear filters" : "Add your business"}
            </Button>
          </div>
        )
      )}
      <BusinessCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onContinue={() => {
          setOnboardingOpen(false);
          setCreateOpen(true);
        }}
      />
      <CreateBusinessDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void fetchBusinesses()}
      />
    </section>
  );
}

export function BusinessDirectoryCard({
  business,
  onOpen,
}: {
  business: Business;
  onOpen: () => void;
}) {
  const photo =
    business.cover_image || business.image_urls?.[0] || business.logo;
  const location = getBusinessLocation(
    business.location,
    business.lga,
    business.state,
  );
  const rating = getBusinessRating(business.rating, business.review_count);
  return (
    <button
      onClick={onOpen}
      className="group flex h-full w-full flex-col overflow-hidden rounded-3xl border border-border bg-card text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="relative flex h-48 w-full items-center justify-center overflow-hidden bg-muted">
        {photo ? (
          <Image
            src={photo}
            alt={business.name}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
          />
        ) : (
          <Store size={48} className="text-muted-foreground/40" />
        )}
        <span className="absolute bottom-3 left-3 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-semibold">
          {getBusinessModeLabel(business.mode)}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {business.category || "Local business"}
        </p>
        <h3 className="mt-1 flex items-center gap-2 font-yrdly-display text-xl font-bold">
          {business.name}
          {business.verified_seller && (
            <BadgeCheck size={18} className="shrink-0 text-primary" />
          )}
        </h3>
        {business.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {business.description}
          </p>
        )}
        <div className="mt-auto space-y-3 pt-5">
          {location && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin size={14} className="shrink-0" />
              <span className="truncate">{location}</span>
            </p>
          )}
          <div className="flex items-center justify-between border-t border-border pt-3 text-xs font-medium">
            {rating ? (
              <span className="flex items-center gap-1.5">
                <Star size={14} className="fill-amber-400 text-amber-500" />
                {rating}
              </span>
            ) : (
              <span className="text-muted-foreground">Meet this business</span>
            )}
            <span className="flex items-center gap-1 text-primary">
              Explore <ArrowUpRight size={16} />
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
