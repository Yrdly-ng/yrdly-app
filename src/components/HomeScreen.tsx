"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-supabase-auth";
import { usePosts } from "@/hooks/use-posts";
import { useLocation } from "@/contexts/LocationContext";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyFeed } from "@/components/EmptyFeed";
import { CreatePostDialog } from "@/components/CreatePostDialog";
import { CreateItemDialog } from "@/components/CreateItemDialog";
import { PostCard } from "@/components/PostCard";
import { PostSkeleton } from "@/components/PostSkeleton";
import { LocationChip } from "@/components/LocationChip";
import { EventCreatorOnboarding } from "@/components/events/EventCreatorOnboarding";
import { MarketplaceCreatorOnboarding } from "@/components/marketplace/MarketplaceCreatorOnboarding";
import { GlassCard } from "@/components/ui/glass-card";
import Image from "next/image";

function HandshakeGradient() {
  return (
    <svg width="22" height="22" viewBox="0 0 42 42" fill="none">
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

function TicketGradient() {
  return (
    <svg width="22" height="22" viewBox="0 0 42 42" fill="none">
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

function PhotoGradient() {
  return (
    <svg width="22" height="22" viewBox="0 0 42 42" fill="none">
      <defs>
        <linearGradient id="pg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="17.37%" stopColor="#00C2FF" />
          <stop offset="85.3%" stopColor="#0057FF" />
        </linearGradient>
      </defs>
      <rect x="4" y="8" width="34" height="26" rx="4" fill="url(#pg1)" />
      <circle cx="13" cy="17" r="3.5" fill="var(--yrdly-dark)" />
      <path d="M6 30l9-9 6 6 7-9 12 12" stroke="var(--yrdly-dark)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

const GREEN = "hsl(var(--primary))";

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
  const { posts, loading, loadingMore, hasMore, loadMore, deletePost, createPost } = usePosts(activeFilter);

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

  // Auto-load the next page when the sentinel scrolls into view.
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
    <div className="w-full pb-4 space-y-4 font-yrdly-body">

      {/* ── Location Chip ── */}
      <div className="flex items-center gap-2 px-1">
        <LocationChip />
      </div>

      {/* ── Quick Post Box (Mobile Parity) ── */}
      <CreatePostDialog createPost={createPost}>
        <GlassCard className="flex items-center gap-3 p-3 rounded-[24px] cursor-pointer transition-all hover:bg-white/5">
          <div
            className="w-10 h-10 rounded-full border-2 overflow-hidden flex-shrink-0 flex items-center justify-center"
            style={{ borderColor: GREEN, background: "var(--yrdly-glass-bg)" }}
          >
            {profile?.avatar_url ? (
              <Image src={profile.avatar_url} alt={profile.name || "User"} width={40} height={40} className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm font-bold text-primary font-yrdly-display">
                {profile?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || "U"}
              </span>
            )}
          </div>

          <span className="flex-1 text-sm text-[var(--yrdly-label)] truncate font-yrdly-body">
            What&apos;s happening in your neighbourhood?
          </span>

          <button
            className="h-8 px-4 rounded-full font-bold text-xs text-black shrink-0 transition-transform active:scale-95 font-yrdly-display"
            style={{ background: GREEN }}
          >
            Post
          </button>
        </GlassCard>
      </CreatePostDialog>

      {/* ── Action Buttons Row ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={handleSellClick}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-[0.875rem] font-bold text-[#15803D] bg-[#DCFCE7] border border-[#BBF7D0] dark:text-emerald-300 dark:bg-slate-800/80 dark:border-emerald-900/50 transition-transform active:scale-95 font-yrdly-display"
        >
          <HandshakeGradient />
          Sell
        </button>

        <button
          onClick={handleEventClick}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-[0.875rem] font-bold whitespace-nowrap text-[#7E22CE] bg-[#F3E8FF] border border-[#E9D5FF] dark:text-purple-300 dark:bg-slate-800/80 dark:border-purple-900/50 transition-transform active:scale-95 font-yrdly-display"
        >
          <TicketGradient />
          Event
        </button>
      </div>

      {/* Event Creator Onboarding */}
      <EventCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
      />

      {/* Marketplace Creator Onboarding */}
      <MarketplaceCreatorOnboarding
        isOpen={marketplaceOnboardingOpen}
        onClose={() => setMarketplaceOnboardingOpen(false)}
        onContinue={() => setIsCreateItemOpen(true)}
      />

      {/* Create item dialog */}
      <CreateItemDialog
        open={isCreateItemOpen}
        onOpenChange={setIsCreateItemOpen}
      />

      {/* ── Feed ── */}
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
                <span className="text-sm font-medium text-[var(--yrdly-label)] font-yrdly-body">Loading more...</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="py-8">
          <EmptyFeed createPost={createPost} />
        </div>
      )}
    </div>
  );
}