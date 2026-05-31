"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-supabase-auth";
import { usePosts } from "@/hooks/use-posts";
import { useLocation } from "@/contexts/LocationContext";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyFeed } from "@/components/EmptyFeed";
import { CreatePostDialog } from "@/components/CreatePostDialog";
import Link from "next/link";
import { CreateItemDialog } from "@/components/CreateItemDialog";
import { PostCard } from "@/components/PostCard";
import { LocationChip } from "@/components/LocationChip";
import { EventCreatorOnboarding } from "@/components/events/EventCreatorOnboarding";
import { MarketplaceCreatorOnboarding } from "@/components/marketplace/MarketplaceCreatorOnboarding";


/* ─── gradient SVG icons ──────────────────────────────────────── */
function HandshakeGradient() {
  return (
    <svg width="24" height="24" viewBox="0 0 42 42" fill="none">
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
    <svg width="24" height="24" viewBox="0 0 42 42" fill="none">
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


const FONT_RALEWAY = "Pacifico", cursive;
const GREEN = "#388E3C";

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
    <div className="w-full pb-4 space-y-3">
      {/* ── Location Chip ── */}
      <div className="flex items-center gap-2 px-1">
        <LocationChip />
      </div>
      {/* ── Post Bar ── */}
      <div className="rounded-[11px] overflow-hidden" style={{ background: "var(--c-card)" }}>
        <div className="p-4">
          {/* Input row */}
          <div className="flex items-center gap-3">
            <Avatar className="w-9 h-9 flex-shrink-0">
              <AvatarImage src={profile?.avatar_url || ""} />
              <AvatarFallback className="text-sm text-foreground" style={{ background: GREEN }}>
                {profile?.name?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>
            <CreatePostDialog createPost={createPost}>
              <button
                className="flex-1 h-10 rounded-full text-left px-4 font-sans font-light text-[0.75rem] text-muted-foreground hover:text-foreground transition-colors"
                style={{ background: "var(--c-bg)", border: `0.5px solid ${GREEN}`, fontFamily: FONT_RALEWAY }}
              >
                What&apos;s going on?
              </button>
            </CreatePostDialog>
          </div>

          {/* Divider */}
          <div className="my-3" style={{ borderTop: "0.2px solid var(--c-border)" }} />

          {/* Action buttons - horizontally scrollable on small screens */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
            <button
              onClick={() => setMarketplaceOnboardingOpen(true)}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-foreground text-[0.875rem] font-bold hover:bg-accent transition-colors"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              <HandshakeGradient />
              Sell
            </button>


            <button
              onClick={() => setOnboardingOpen(true)}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-foreground text-[0.875rem] font-bold hover:bg-accent transition-colors"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              <TicketGradient />
              Event
            </button>

          </div>
        </div>
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
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-[11px]" style={{ background: "var(--c-card)" }} />
          ))}
        </div>
      ) : posts.length > 0 ? (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onDelete={deletePost} onCreatePost={createPost} />
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
