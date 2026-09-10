"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { usePosts } from "@/hooks/use-posts";
import { useLocation } from "@/contexts/LocationContext";
import { CreatePostDialog } from "@/components/CreatePostDialog";
import { CreateItemDialog } from "@/components/CreateItemDialog";
import { PostCard } from "@/components/PostCard";
import { PostSkeleton } from "@/components/PostSkeleton";
import { LocationChip } from "@/components/LocationChip";
import { EventCreatorOnboarding } from "@/components/events/EventCreatorOnboarding";
import { MarketplaceCreatorOnboarding } from "@/components/marketplace/MarketplaceCreatorOnboarding";
import { Map, Bell, AlertTriangle, X } from "lucide-react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

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
  const [marketplaceOnboardingOpen, setMarketplaceOnboardingOpen] = useState(false);
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);

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
        const { data } = await supabase
          .from("safety_alerts")
          .select("*")
          .eq("status", "approved")
          .order("created_at", { ascending: false })
          .limit(3);

        if (data) {
          const visible = data.filter(
            (a) => !localStorage.getItem(`yrdly_dismissed_alert_${a.id}`)
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
    <div className="w-full max-w-2xl mx-auto space-y-4 font-yrdly-body pb-24">
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
      <CreatePostDialog createPost={createPost}>
        <div className="flex items-center gap-3 p-3 rounded-3xl border border-[var(--yrdly-glass-border)] bg-card cursor-pointer transition-all hover:bg-white/5">
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
      </CreatePostDialog>

      {/* Onboarding Dialogs */}
      <EventCreatorOnboarding isOpen={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
      <MarketplaceCreatorOnboarding
        isOpen={marketplaceOnboardingOpen}
        onClose={() => setMarketplaceOnboardingOpen(false)}
        onContinue={() => setIsCreateItemOpen(true)}
      />
      <CreateItemDialog open={isCreateItemOpen} onOpenChange={setIsCreateItemOpen} />

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
  );
}