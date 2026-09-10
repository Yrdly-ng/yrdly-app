"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CommunityScreen } from "@/components/CommunityScreen";
import { MarketplaceScreen } from "@/components/MarketplaceScreen";
import { EventsScreen } from "@/components/EventsScreen";
import { BusinessesScreen } from "@/components/BusinessesScreen";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketplaceActions } from "@/hooks/use-marketplace-actions";
import { AlertService } from "@/lib/alert-service";
import { Search, SlidersHorizontal, Compass, ShoppingBag, Calendar, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { LocationChip } from "@/components/LocationChip";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-raleway)";
const GREEN = "hsl(var(--primary))";

type ExploreTab = "discover" | "marketplace" | "events" | "businesses";

const TABS: { key: ExploreTab; label: string; icon: any }[] = [
  { key: "discover", label: "Discover", icon: Compass },
  { key: "marketplace", label: "Marketplace", icon: ShoppingBag },
  { key: "events", label: "Events", icon: Calendar },
  { key: "businesses", label: "Business", icon: Briefcase },
];

function MarketplaceTab() {
  const { handleItemClick, handleMessageSeller } = useMarketplaceActions();
  return (
    <MarketplaceScreen
      onItemClick={handleItemClick}
      onMessageSeller={handleMessageSeller}
    />
  );
}

function ExploreContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as ExploreTab | null;
  const activeTab: ExploreTab =
    tabParam && TABS.some((t) => t.key === tabParam) ? tabParam : "discover";

  const [activeAlerts, setActiveAlerts] = useState(0);

  useEffect(() => {
    let cancelled = false;
    AlertService.getActiveAlerts().then((alerts) => {
      if (!cancelled) {
        setActiveAlerts(alerts.filter((a) => a.status !== "resolved").length);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectTab = (tab: ExploreTab) => {
    router.push(`/explore?tab=${tab}`, { scroll: false });
  };

  const tabContent = useMemo(() => {
    switch (activeTab) {
      case "marketplace":
        return <MarketplaceTab />;
      case "events":
        return <EventsScreen />;
      case "businesses":
        return (
          <Suspense fallback={
            <div className="grid grid-cols-2 gap-3.5 p-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-44 w-full rounded-2xl" />
              ))}
            </div>
          }>
            <BusinessesScreen backTarget="/explore?tab=businesses" />
          </Suspense>
        );
      default:
        return <CommunityScreen />;
    }
  }, [activeTab]);

  return (
    <div className="pb-28 max-w-2xl mx-auto px-4 pt-4 min-h-[100dvh]" style={{ background: "var(--c-bg)" }}>
      {/* ── Header Bar ── */}
      <div className="flex items-center justify-between pb-3 mb-2">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground font-yrdly-display">
            Explore
          </h1>
          <div className="mt-0.5">
            <LocationChip />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeAlerts > 0 && (
            <button
              onClick={() => router.push("/alerts")}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-500 border border-red-500/20"
            >
              <span>{activeAlerts} Active Alert{activeAlerts > 1 ? "s" : ""}</span>
            </button>
          )}

          <button
            onClick={() => router.push("/search")}
            className="p-2.5 rounded-full bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground hover:bg-primary/10 transition-colors"
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Top Filter Tabs (Mobile Parity) ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
        {TABS.map(({ key, label }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => selectTab(key)}
              className="whitespace-nowrap rounded-full px-5 py-2.5 text-xs font-extrabold transition-all shrink-0 font-yrdly-display"
              style={{
                background: isActive ? GREEN : "var(--yrdly-glass-bg)",
                color: isActive ? "#000" : "var(--yrdly-text-primary)",
                border: isActive ? "none" : "1px solid var(--yrdly-glass-border)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Main Tab Content ── */}
      <div>
        {tabContent}
      </div>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <Skeleton className="h-10 w-full rounded-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    }>
      <ExploreContent />
    </Suspense>
  );
}
