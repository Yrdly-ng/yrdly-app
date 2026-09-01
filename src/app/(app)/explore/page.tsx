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
import { Compass, Storefront, CalendarBlank, Buildings, Siren } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const FONT = "var(--font-work-sans)";
const HEADING_FONT = "var(--font-jersey25)";

type ExploreTab = "discover" | "marketplace" | "events" | "businesses";

const TABS: { key: ExploreTab; label: string; icon: typeof Compass }[] = [
  { key: "discover", label: "Discover", icon: Compass },
  { key: "marketplace", label: "Marketplace", icon: Storefront },
  { key: "events", label: "Events", icon: CalendarBlank },
  { key: "businesses", label: "Businesses", icon: Buildings },
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
    <div className="pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pt-1 pb-3">
        <div className="min-w-0">
          <h1 className="text-3xl text-foreground leading-tight" style={{ fontFamily: HEADING_FONT }}>
            Explore
          </h1>
          <p className="text-sm truncate" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
            People, market, events and businesses near you
          </p>
        </div>
        {activeAlerts > 0 && (
          <button
            onClick={() => router.push("/alerts")}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.7rem] font-bold"
            style={{
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "#ef4444",
              fontFamily: FONT,
            }}
          >
            <Siren size={14} weight="bold" />
            {activeAlerts} {activeAlerts === 1 ? "ALERT" : "ALERTS"}
          </button>
        )}
      </div>

      {/* Tab strip */}
      <div
        className="sticky top-[64px] md:top-[84px] z-20 -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 py-2.5 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--c-bg) 92%, transparent)" }}
      >
        <div
          className="flex items-center gap-1 p-1 rounded-full overflow-x-auto"
          style={{ background: "var(--c-card2)", border: "0.5px solid var(--c-border)" }}
        >
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = key === activeTab;
            return (
              <button
                key={key}
                onClick={() => selectTab(key)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-[0.8rem] font-semibold whitespace-nowrap transition-all duration-150",
                  active
                    ? "bg-[var(--primary)] text-white shadow-sm"
                    : "text-[var(--c-text-muted)] hover:text-[var(--foreground)]"
                )}
                style={{ fontFamily: FONT }}
              >
                <Icon size={15} weight={active ? "fill" : "regular"} />
                <span className="hidden min-[420px]:inline">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active tab content */}
      <div className="pt-2">{tabContent}</div>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={
      <div className="space-y-4 pt-2">
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-12 w-full rounded-full" />
        <Skeleton className="h-72 w-full rounded-[1.5rem]" />
      </div>
    }>
      <ExploreContent />
    </Suspense>
  );
}
