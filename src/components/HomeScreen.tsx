"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-supabase-auth";
import { usePosts } from "@/hooks/use-posts";
import { useLocation } from "@/contexts/LocationContext";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyFeed } from "@/components/EmptyFeed";
import { CreatePostDialog } from "@/components/CreatePostDialog";
import { CreateItemDialog } from "@/components/CreateItemDialog";
import { PostCard } from "@/components/PostCard";
import { LocationChip } from "@/components/LocationChip";
import { EventCreatorOnboarding } from "@/components/events/EventCreatorOnboarding";
import { MarketplaceCreatorOnboarding } from "@/components/marketplace/MarketplaceCreatorOnboarding";
import { Spotlight } from "@/components/ui/Spotlight";
import { Magnetic } from "@/components/ui/Magnetic";
import { RevealOnScroll } from "@/components/ui/RevealOnScroll";



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
      <circle cx="4" cy="21" r="4" fill="var(--c-bg)" />
      <circle cx="38" cy="21" r="4" fill="var(--c-bg)" />
      <line x1="18" y1="14" x2="18" y2="28" stroke="var(--c-bg)" strokeWidth="1.5" strokeDasharray="3 2" />
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
      <circle cx="13" cy="17" r="3.5" fill="var(--c-bg)" />
      <path d="M6 30l9-9 6 6 7-9 12 12" stroke="var(--c-bg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}


const FONT_RALEWAY = "var(--font-raleway)";
const GREEN = "hsl(var(--primary))";

interface HomeScreenProps {
  onViewProfile?: (user: unknown) => void;
}

export function HomeScreen({ onViewProfile }: HomeScreenProps) {
  const { user, profile } = useAuth();
  const { activeFilter } = useLocation();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [marketplaceOnboardingOpen, setMarketplaceOnboardingOpen] = useState(false);
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);
  const { posts, loading, deletePost, createPost } = usePosts(activeFilter);


  return (
    <div className="relative overflow-hidden w-full pb-4 space-y-4 bg-[var(--c-bg)] rounded-[1.5rem] border border-[var(--c-border)] shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
      <div className="pointer-events-none absolute -left-10 top-6 h-44 w-44 rounded-full bg-[rgba(92,213,120,0.08)] blur-3xl" />
      <div className="pointer-events-none absolute right-8 top-14 h-32 w-32 rounded-full bg-[rgba(71,185,122,0.06)] blur-3xl" />

      {/* ── Location Chip ── */}
      <div className="flex items-center gap-2 px-1">
        <LocationChip />
      </div>


      {/* ── Post Bar ── */}
      <Spotlight
        className="overflow-hidden rounded-[1.25rem] border border-[var(--c-border)] bg-[var(--c-card)]"
        color="rgba(92,213,120,0.10)"
      >

        <div className="p-4">
          {/* Input row */}
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10 flex-shrink-0">
              <AvatarImage src={profile?.avatar_url || ""} />
              <AvatarFallback className="text-sm text-white font-semibold" style={{ background: GREEN }}>
                {profile?.name?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>
            <CreatePostDialog createPost={createPost}>
              <button
                className="flex-1 h-12 rounded-full text-left px-4 font-sans font-medium text-[0.95rem] text-muted-foreground bg-[var(--background)] hover:bg-[var(--c-card2)] hover:text-[var(--c-text)] border border-[var(--c-border)] transition-all duration-150"
                style={{ fontFamily: FONT_RALEWAY }}
              >
                What&apos;s on your mind?
              </button>
            </CreatePostDialog>
          </div>

          {/* Divider */}
          <div className="my-3" style={{ borderTop: "0.5px solid var(--c-border)" }} />

          {/* Action buttons - horizontally scrollable on small screens */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
            <CreatePostDialog createPost={createPost}>
              <Magnetic
                className="flex items-center gap-2 rounded-full px-4 py-2 text-[0.9rem] font-semibold text-[#0369A1] bg-[#E0F2FE] border border-[#BAE6FD] shadow-sm hover:bg-[#BAE6FD] dark:text-sky-300 dark:bg-slate-800/80 dark:border-sky-900/50 dark:hover:bg-slate-700/80 dark:shadow-[0_0_12px_rgba(56,189,248,0.15)]"
                style={{ fontFamily: FONT_RALEWAY }}
              >
                <PhotoGradient />
                Photo
              </Magnetic>
            </CreatePostDialog>

            <Magnetic
              onClick={() => setMarketplaceOnboardingOpen(true)}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-[0.9rem] font-semibold text-[#15803D] bg-[#DCFCE7] border border-[#BBF7D0] shadow-sm hover:bg-[#BBF7D0] dark:text-emerald-300 dark:bg-slate-800/80 dark:border-emerald-900/50 dark:hover:bg-slate-700/80 dark:shadow-[0_0_12px_rgba(52,211,153,0.15)]"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              <HandshakeGradient />
              Sell
            </Magnetic>


            <Magnetic
              onClick={() => setOnboardingOpen(true)}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-[0.9rem] font-semibold text-[#7E22CE] bg-[#F3E8FF] border border-[#E9D5FF] shadow-sm hover:bg-[#E9D5FF] dark:text-purple-300 dark:bg-slate-800/80 dark:border-purple-900/50 dark:hover:bg-slate-700/80 dark:shadow-[0_0_12px_rgba(192,132,252,0.15)]"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              <TicketGradient />
              Create Event
            </Magnetic>

          </div>
        </div>
      </Spotlight>

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
            <Skeleton key={i} className="h-72 w-full rounded-[1.5rem] shadow-sm" style={{ background: "var(--c-card)" }} />
          ))}
        </div>
      ) : posts.length > 0 ? (
        <div>
          {posts.map((post, idx) => (
            <RevealOnScroll key={post.id} delay={Math.min(idx, 4) * 60}>
              <PostCard post={post} onDelete={deletePost} onCreatePost={createPost} />
            </RevealOnScroll>
          ))}
        </div>
      ) : (
        <div className="py-8">
          <EmptyFeed createPost={createPost} />
        </div>
      )}
    </div>
  );
}