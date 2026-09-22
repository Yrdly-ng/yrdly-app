"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { usePosts } from "@/hooks/use-posts";
import { useLocation } from "@/contexts/LocationContext";
import { PostCard } from "@/components/PostCard";
import { PostSkeleton } from "@/components/PostSkeleton";
import { LocationChip } from "@/components/LocationChip";
import { EventCreatorOnboarding } from "@/components/events/EventCreatorOnboarding";
import { MarketplaceCreatorOnboarding } from "@/components/marketplace/MarketplaceCreatorOnboarding";
import { Map, Bell, AlertTriangle, X, TrendingUp, CalendarDays, UserPlus, LayoutGrid, Heart, ArrowUp, Plus } from "lucide-react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { useCommunityConnections } from "@/hooks/use-community-connections";
import { getPublishedEvents } from "@/lib/event-service";
import type { Event } from "@/types/events";

const GREEN = "#82DB7E";

function HandshakeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 42 42" fill="none">
      <defs>
        <linearGradient id="hg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="17.37%" stopColor="#FFD600" />
          <stop offset="85.3%" stopColor="#00D078" />
        </linearGradient>
      </defs>
      <path d="M6 22l5-5 4 2 5-5h4l5 5 4-2 5 5-9 7-5-3-5 3L6 22z" fill="url(#hg1)" />
      <path d="M14 19l3 8M28 19l-3 8" stroke="url(#hg1)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 42 42" fill="none">
      <defs>
        <linearGradient id="tg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="17.37%" stopColor="#FF0048" />
          <stop offset="85.3%" stopColor="#7D00D0" />
        </linearGradient>
      </defs>
      <rect x="4" y="14" width="34" height="14" rx="3" fill="url(#tg1)" />
      <circle cx="4" cy="21" r="4" fill="var(--yrdly-dark)" />
      <circle cx="38" cy="21" r="4" fill="var(--yrdly-dark)" />
      <line x1="18" y1="14" x2="18" y2="28" stroke="var(--yrdly-dark)" strokeWidth="1.5" strokeDasharray="3 2" />
    </svg>
  );
}

interface Alert {
  id: string;
  title: string;
  description: string;
  severity: "information" | "caution" | "urgent";
  type: string;
  area_name: string;
  created_at: string;
}

interface HomeScreenProps {
  onViewProfile?: (user: unknown) => void;
}

export function HomeScreen({ onViewProfile }: HomeScreenProps) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const { activeFilter } = useLocation();

  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false);
  const [marketplaceOnboardingOpen, setMarketplaceOnboardingOpen] = useState(false);
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);

  // Sidebar data
  const { discoverUsers, followUser } = useCommunityConnections();
  const [trendingPosts, setTrendingPosts] = useState<
    { id: string; category: string; snippet: string; image: string; like_count: number }[]
  >([]);
  // ── Trending reorder animation (FLIP) ──
  const trendingRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const trendingPrevTops = useRef<Record<string, number>>({});
  const trendingPrevRanks = useRef<Record<string, number>>({});
  const [risingTrendingIds, setRisingTrendingIds] = useState<Set<string>>(new Set());
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const [recentListings, setRecentListings] = useState<
    { id: string; title: string; price: number; image: string }[]
  >([]);

  useEffect(() => {
    const fetchTrending = async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        let query = supabase
          .from("posts")
          .select("id, category, title, text, image_url, image_urls, liked_by")
          .gte("created_at", since);

        if (activeFilter?.state) {
          query = query.eq("state", activeFilter.state);
        }
        if (activeFilter?.lga) {
          query = query.eq("lga", activeFilter.lga);
        }

        const { data } = await query.limit(50);

        const ranked = (data || [])
          .map((p: any) => ({
            id: p.id,
            category: p.category,
            snippet: p.title || p.text?.split("\n")[0] || "Post",
            image: p.image_urls?.[0] || p.image_url || "",
            like_count: Array.isArray(p.liked_by) ? p.liked_by.length : 0,
          }))
          .sort((a, b) => b.like_count - a.like_count)
          .slice(0, 3);

        // Capture current row positions before re-ordering (for the FLIP slide animation)
        const tops: Record<string, number> = {};
        Object.entries(trendingRowRefs.current).forEach(([id, el]) => {
          if (el) tops[id] = el.getBoundingClientRect().top;
        });
        trendingPrevTops.current = tops;

        // Work out which posts climbed the ranking (or are new) to give them a brief highlight
        const rising = new Set<string>();
        ranked.forEach((p, i) => {
          const prevRank = trendingPrevRanks.current[p.id];
          if (prevRank === undefined || i < prevRank) rising.add(p.id);
        });
        const nextRanks: Record<string, number> = {};
        ranked.forEach((p, i) => {
          nextRanks[p.id] = i;
        });
        trendingPrevRanks.current = nextRanks;

        if (rising.size > 0) {
          setRisingTrendingIds(rising);
          setTimeout(() => setRisingTrendingIds(new Set()), 900);
        }

        setTrendingPosts(ranked);
      } catch (e) {
        console.error("Error fetching trending posts:", e);
      }
    };
    fetchTrending();

    const interval = setInterval(fetchTrending, 4000);

    const ch = supabase
      .channel(`home_trending_posts_${Math.random().toString(36).substring(2, 7)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "posts" },
        fetchTrending
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(ch);
    };
  }, [activeFilter]);

  // Slide rows smoothly into their new position instead of snapping (FLIP animation)
  useLayoutEffect(() => {
    Object.entries(trendingPrevTops.current).forEach(([id, prevTop]) => {
      const el = trendingRowRefs.current[id];
      if (!el) return;
      const newTop = el.getBoundingClientRect().top;
      const delta = prevTop - newTop;
      if (delta) {
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 450ms cubic-bezier(0.22,1,0.36,1)";
          el.style.transform = "";
        });
      }
    });
  }, [trendingPosts]);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const events = await getPublishedEvents({ limit: 3 });
        setUpcomingEvents(events);
      } catch (e) {
        console.error("Error fetching upcoming events:", e);
      }
    };
    fetchEvents();

    const ch = supabase
      .channel(`home_upcoming_events_${Math.random().toString(36).substring(2, 7)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        fetchEvents
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    const fetchListings = async () => {
      try {
        let query = supabase
          .from("posts")
          .select("id, title, text, price, image_url, image_urls")
          .eq("category", "For Sale")
          .eq("is_sold", false);

        if (activeFilter?.state) {
          query = query.eq("state", activeFilter.state);
        }
        if (activeFilter?.lga) {
          query = query.eq("lga", activeFilter.lga);
        }

        const { data } = await query
          .order("created_at", { ascending: false })
          .limit(3);

        const mapped = (data || []).map((item: any) => ({
          id: item.id,
          title: item.title || item.text?.split("\n")[0] || "Item",
          price: item.price || 0,
          image: item.image_urls?.[0] || item.image_url || "",
        }));

        setRecentListings(mapped);
      } catch (e) {
        console.error("Error fetching recent listings:", e);
      }
    };
    fetchListings();

    const ch = supabase
      .channel(`home_recent_listings_${Math.random().toString(36).substring(2, 7)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "posts" },
        fetchListings
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeFilter]);

  const { posts, loading, loadingMore, hasMore, loadMore, deletePost, createPost } = usePosts(activeFilter);

  // Fetch unread notification count
  useEffect(() => {
    if (!user) return;
    const fetchUnread = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      setUnreadNotifCount(count || 0);
    };
    fetchUnread();

    const channel = supabase
      .channel("unread_count_home")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        fetchUnread
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Fetch active safety alerts
  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from("safety_alerts")
          .select("*")
          .eq("status", "approved")
          .gte("created_at", twentyFourHoursAgo)
          .order("created_at", { ascending: false })
          .limit(3);

        if (data) {
          const visible = data.filter(
            (a) => !localStorage.getItem(`yrdly_dismissed_alert_${a.id}`) && !localStorage.getItem(`yrdly_alert_dismissed_${a.id}`)
          );
          setActiveAlerts(visible as Alert[]);
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchAlerts();
  }, []);

  const handleSellClick = () => {
    if (!profile?.phone_verified) {
      router.push("/verify-phone");
      return;
    }
    setMarketplaceOnboardingOpen(true);
  };

  const handleEventClick = () => {
    if (!profile?.phone_verified) {
      router.push("/verify-phone");
      return;
    }
    setOnboardingOpen(true);
  };

  // Sentinel infinite scroll
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);

  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  useEffect(() => {
    if (loading || !hasMore) return;
    const el = loadMoreSentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreRef.current();
        }
      },
      { rootMargin: "600px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, posts.length]);

  return (
    <div className="w-full max-w-[680px] lg:max-w-none mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] gap-6 pb-24">
    <div className="w-full max-w-none space-y-4 font-yrdly-body">
      {/* ── Active Safety Alert Banners (Horizontal Swipe Carousel) ── */}
      {activeAlerts.length > 0 && (
        <div className="flex overflow-x-auto snap-x snap-mandatory gap-3 pb-2 scrollbar-none">
          {activeAlerts.map((alert) => (
            <div
              key={alert.id}
              className="snap-center w-[88%] sm:w-[320px] flex-shrink-0 flex items-start justify-between gap-3 p-4 rounded-2xl border bg-amber-500/10 border-amber-500/30 text-amber-400 backdrop-blur-md"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold font-yrdly-display uppercase tracking-wider truncate">
                    {alert.title} · <span className="text-[var(--yrdly-label)]">{alert.area_name}</span>
                  </h4>
                  <p className="text-xs text-foreground mt-0.5 leading-relaxed font-yrdly-body line-clamp-2">
                    {alert.description}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem(`yrdly_dismissed_alert_${alert.id}`, "true");
                  setActiveAlerts((prev) => prev.filter((a) => a.id !== alert.id));
                }}
                className="text-[var(--yrdly-label)] hover:text-foreground p-1 flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Quick Post Box (Mobile Parity) ── */}
      <div
        onClick={() => router.push("/posts/create")}
        className="flex items-center gap-3 p-3 rounded-3xl border border-[var(--yrdly-glass-border)] bg-card cursor-pointer transition-all hover:bg-white/5"
      >
        <div
          className="w-10 h-10 rounded-full border-2 overflow-hidden flex-shrink-0 flex items-center justify-center"
          style={{ borderColor: GREEN, backgroundColor: "var(--yrdly-dark)" }}
        >
          {profile?.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt={profile.name || "User"}
              width={40}
              height={40}
              className="w-full h-full object-cover"
              unoptimized
            />
          ) : (
            <span className="text-sm font-bold text-[#82DB7E] font-yrdly-display">
              {profile?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || "?"}
            </span>
          )}
        </div>

        <span className="flex-1 text-sm text-[var(--yrdly-label)] truncate font-yrdly-body">
          What&apos;s happening in your neighbourhood?
        </span>

        <button
          type="button"
          className="h-8 px-4 rounded-full font-bold text-xs text-black shrink-0 transition-transform active:scale-95 font-yrdly-display"
          style={{ backgroundColor: GREEN }}
        >
          Post
        </button>
      </div>

      {/* Onboarding Dialogs */}
      <EventCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onContinue={() => router.push("/events/create")}
      />
      <MarketplaceCreatorOnboarding
        isOpen={marketplaceOnboardingOpen}
        onClose={() => setMarketplaceOnboardingOpen(false)}
        onContinue={() => router.push("/marketplace/create")}
      />

      {/* ── Feed List ── */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <PostSkeleton key={i} />
          ))}
        </div>
      ) : posts.length > 0 ? (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onDelete={deletePost} onCreatePost={createPost} />
          ))}

          {hasMore && (
            <div ref={loadMoreSentinelRef} className="flex justify-center py-4">
              {loadingMore && (
                <span className="text-sm font-medium text-[var(--yrdly-label)] font-yrdly-body">
                  Loading more...
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-[var(--yrdly-label)] font-yrdly-body">
            No posts yet. Be the first to post in your neighbourhood!
          </p>
        </div>
      )}
    </div>

    {/* ── Right Sidebar (fixed in place, does not move while the feed scrolls) ── */}
    <div className="hidden lg:block relative shrink-0">
      <aside className="sticky top-[80px] md:top-[100px] flex min-w-0 w-full max-w-full flex-col gap-4 overflow-x-hidden font-yrdly-body items-start overflow-y-auto max-h-[calc(100dvh-100px)] pb-6 scrollbar-hide">
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
        <div className="flex items-center gap-3 mb-4">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${GREEN}22` }}
          >
            <TrendingUp size={17} style={{ color: GREEN }} />
          </span>
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--yrdly-label)] font-yrdly-display">
            Trending nearby
          </h3>
        </div>
        {trendingPosts.length > 0 ? (
          trendingPosts.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                trendingRowRefs.current[p.id] = el;
              }}
              onClick={() => router.push(`/posts/${p.id}`)}
              className={`relative flex min-w-0 w-full max-w-full items-center gap-3 py-2.5 px-2 -mx-1 rounded-lg border-b border-[var(--yrdly-glass-border)] last:border-b-0 cursor-pointer transition-all duration-500 hover:bg-[var(--yrdly-glass-border)]/40 hover:ring-1 hover:ring-inset hover:ring-primary/40 ${
                risingTrendingIds.has(p.id) ? "ring-1 ring-inset ring-primary/60 bg-primary/5" : ""
              }`}
            >
              <div className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 bg-background flex items-center justify-center">
                {p.image ? (
                  <Image src={p.image} alt={p.snippet} width={44} height={44} className="w-full h-full object-cover" unoptimized />
                ) : (
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: GREEN }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="min-w-0 break-words line-clamp-2 text-[15px] font-bold">{p.snippet}</div>
                <div className="text-xs text-[var(--yrdly-label)] capitalize">{p.category}</div>
              </div>
              <span className="flex items-center gap-1 text-sm text-[var(--yrdly-label)] flex-shrink-0">
                {risingTrendingIds.has(p.id) && (
                  <ArrowUp size={13} className="animate-bounce" style={{ color: GREEN }} />
                )}
                <Heart size={13} />
                {p.like_count}
              </span>
            </div>
          ))
        ) : (
          <p className="text-xs text-[var(--yrdly-label)]">No trending posts yet.</p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
        <div className="flex items-center gap-3 mb-4">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#B24C7A22" }}
          >
            <LayoutGrid size={17} style={{ color: "#B24C7A" }} />
          </span>
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--yrdly-label)] font-yrdly-display">
            Fresh listings
          </h3>
        </div>
        {recentListings.length > 0 ? (
          recentListings.map((item) => (
            <div
              key={item.id}
              onClick={() => router.push(`/marketplace/${item.id}`)}
              className="flex items-center gap-3.5 py-2.5 px-2 -mx-1 rounded-lg border-b border-[var(--yrdly-glass-border)] last:border-b-0 cursor-pointer transition-all hover:bg-[var(--yrdly-glass-border)]/40 hover:ring-1 hover:ring-inset hover:ring-primary/40"
            >
              <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-background">
                {item.image && (
                  <Image src={item.image} alt={item.title} width={48} height={48} className="w-full h-full object-cover" unoptimized />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold truncate">{item.title}</div>
                <div className="text-sm text-[var(--yrdly-label)]">₦{item.price?.toLocaleString()}</div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-[var(--yrdly-label)]">No listings yet.</p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
        <div className="flex items-center gap-3 mb-4">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#C97A2E22" }}
          >
            <CalendarDays size={17} style={{ color: "#C97A2E" }} />
          </span>
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--yrdly-label)] font-yrdly-display">
            Upcoming events
          </h3>
        </div>
        {upcomingEvents.length > 0 ? (
          upcomingEvents.map((e: any) => {
            const d = new Date(e.start_time);
            const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
            const day = d.getDate();
            return (
              <div
                key={e.id}
                onClick={() => router.push(`/events/${e.id}`)}
                className="flex gap-3.5 py-2.5 px-2 -mx-1 rounded-lg border-b border-[var(--yrdly-glass-border)] last:border-b-0 cursor-pointer transition-all hover:bg-[var(--yrdly-glass-border)]/40 hover:ring-1 hover:ring-inset hover:ring-primary/40"
              >
                <div
                  className="text-xs font-bold text-center leading-tight rounded-lg px-2.5 py-1.5 h-fit flex-shrink-0"
                  style={{ backgroundColor: "#C97A2E1A", color: "#C97A2E" }}
                >
                  {month}
                  <br />
                  <span className="text-base">{day}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-bold truncate">{e.title}</div>
                  <div className="text-sm text-[var(--yrdly-label)] mt-0.5 truncate">
                    📍 {e.location_address || "TBA"} · {e.attendee_count || 0} going
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-[var(--yrdly-label)]">No upcoming events nearby.</p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
        <div className="flex items-center gap-3 mb-4">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#2F6FA822" }}
          >
            <UserPlus size={17} style={{ color: "#2F6FA8" }} />
          </span>
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--yrdly-label)] font-yrdly-display">
            People to follow
          </h3>
        </div>
        {discoverUsers.length > 0 ? (
          discoverUsers.slice(0, 3).map((u: any) => (
            <div key={u.id} className="flex flex-col gap-2 py-2.5 px-2 -mx-1 rounded-lg transition-all hover:bg-[var(--yrdly-glass-border)]/40 hover:ring-1 hover:ring-inset hover:ring-primary/40">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  onClick={() => router.push(`/profile/${u.id}`)}
                  className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-sm font-bold flex-shrink-0 ring-2 cursor-pointer"
                  style={{ backgroundColor: "var(--yrdly-dark)", color: GREEN, ["--tw-ring-color" as any]: `${GREEN}40` }}
                >
                  {u.avatar_url ? (
                    <Image src={u.avatar_url} alt={u.name} width={44} height={44} className="w-full h-full object-cover" unoptimized />
                  ) : (
                    u.name?.charAt(0)?.toUpperCase() || "?"
                  )}
                </div>
                <span
                  onClick={() => router.push(`/profile/${u.id}`)}
                  className="flex-1 min-w-0 text-[15px] font-semibold leading-snug break-words cursor-pointer hover:underline"
                >
                  {u.name}
                </span>
                <button
                  type="button"
                  onClick={() => followUser(u.id)}
                  aria-label={`Follow ${u.name}`}
                  className="w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors hover:text-black"
                  style={{ borderColor: GREEN, color: GREEN }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.backgroundColor = GREEN)}
                  onMouseLeave={(ev) => (ev.currentTarget.style.backgroundColor = "transparent")}
                >
                  <Plus size={15} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-[var(--yrdly-label)]">No suggestions right now.</p>
        )}
      </div>

    </aside>
    </div>
    </div>
  );
}
