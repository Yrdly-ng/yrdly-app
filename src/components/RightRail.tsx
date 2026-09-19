"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { getPublishedEvents } from "@/lib/event-service";
import type { Event } from "@/types/events";
import { ProfileQuickAccess } from "./ProfileQuickAccess";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, UserPlus, MapPin, Check, ArrowRight } from "lucide-react";

interface RightRailProps {
  hasBusiness: boolean;
  userBusinessId: string | null;
  onOpenStore: () => void;
  isOwnProfile: boolean;
  viewerLga?: string | null;
  viewerId?: string | null;
  profileUserId?: string | null;
}

interface NeighborUser {
  id: string;
  name: string;
  username?: string;
  avatar_url?: string;
  home_lga?: string;
}

export function RightRail({
  hasBusiness,
  userBusinessId,
  onOpenStore,
  isOwnProfile,
  viewerLga,
  viewerId,
  profileUserId,
}: RightRailProps) {
  const [neighbors, setNeighbors] = useState<NeighborUser[]>([]);
  const [loadingNeighbors, setLoadingNeighbors] = useState(false);
  const [followedNeighbors, setFollowedNeighbors] = useState<Record<string, boolean>>({});
  const [followLoading, setFollowLoading] = useState<Record<string, boolean>>({});

  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Fetch Neighbors
  useEffect(() => {
    if (!viewerId || !viewerLga) {
      setNeighbors([]);
      return;
    }

    const fetchNeighbors = async () => {
      setLoadingNeighbors(true);
      try {
        const { data: followedData } = await supabase
          .from("followers")
          .select("following_id")
          .eq("follower_id", viewerId);

        const followedIds = new Set((followedData || []).map((f) => f.following_id));

        const { data: usersData } = await supabase
          .from("users")
          .select("id, name, username, avatar_url, home_lga")
          .eq("home_lga", viewerLga)
          .neq("id", viewerId)
          .limit(15);

        if (usersData) {
          const unFollowed = usersData
            .filter((u) => !followedIds.has(u.id) && (!profileUserId || u.id !== profileUserId))
            .slice(0, 5);
          setNeighbors(unFollowed);
        }
      } catch (err) {
        console.error("Error fetching neighbors:", err);
      } finally {
        setLoadingNeighbors(false);
      }
    };

    fetchNeighbors();
  }, [viewerId, viewerLga, profileUserId]);

  // Fetch Nearby Events
  useEffect(() => {
    const fetchEvents = async () => {
      setLoadingEvents(true);
      try {
        const fetchedEvents = await getPublishedEvents({
          lga: viewerLga || undefined,
          limit: 3,
        });
        setEvents(fetchedEvents);
      } catch (err) {
        console.error("Error fetching nearby events:", err);
      } finally {
        setLoadingEvents(false);
      }
    };

    fetchEvents();
  }, [viewerLga]);

  const handleFollowNeighbor = async (neighborId: string) => {
    if (!viewerId) return;
    setFollowLoading((prev) => ({ ...prev, [neighborId]: true }));
    try {
      if (followedNeighbors[neighborId]) {
        await supabase
          .from("followers")
          .delete()
          .eq("follower_id", viewerId)
          .eq("following_id", neighborId);
        setFollowedNeighbors((prev) => ({ ...prev, [neighborId]: false }));
      } else {
        await supabase
          .from("followers")
          .insert({ follower_id: viewerId, following_id: neighborId });
        setFollowedNeighbors((prev) => ({ ...prev, [neighborId]: true }));
      }
    } catch (err) {
      console.error("Error toggling follow neighbor:", err);
    } finally {
      setFollowLoading((prev) => ({ ...prev, [neighborId]: false }));
    }
  };

  return (
    <aside className="w-[340px] space-y-6 sticky top-4">
      {/* Widget 1: Quick Access (Own Profile only) */}
      {isOwnProfile && (
        <div>
          <ProfileQuickAccess
            hasBusiness={hasBusiness}
            onOpenStore={onOpenStore}
          />
        </div>
      )}

      {/* Widget 2: Neighbors */}
      {viewerLga && (
        <GlassCard className="p-4 rounded-[20px] space-y-3">
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground font-yrdly-display">
                Neighbors in {viewerLga}
              </h3>
            </div>
          </div>

          {loadingNeighbors ? (
            <div className="space-y-3 pt-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-8 w-16 rounded-full" />
                </div>
              ))}
            </div>
          ) : neighbors.length > 0 ? (
            <div className="space-y-3 pt-1">
              {neighbors.map((neighbor) => {
                const isFollowing = !!followedNeighbors[neighbor.id];
                const isBtnLoading = !!followLoading[neighbor.id];
                return (
                  <div
                    key={neighbor.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <Link
                      href={`/profile/${neighbor.id}`}
                      className="flex items-center gap-3 min-w-0 flex-1 group"
                    >
                      <Avatar className="w-10 h-10 border border-primary/20">
                        <AvatarImage
                          src={neighbor.avatar_url || "/placeholder.svg"}
                          className="object-cover"
                        />
                        <AvatarFallback className="bg-primary text-black font-bold font-yrdly-display">
                          {neighbor.name?.charAt(0).toUpperCase() || "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-foreground truncate font-yrdly-display group-hover:text-primary transition-colors">
                          {neighbor.name}
                        </p>
                        <p className="text-xs text-[var(--yrdly-label)] truncate font-yrdly-body">
                          @{neighbor.username || "user"}
                        </p>
                      </div>
                    </Link>

                    <button
                      onClick={() => handleFollowNeighbor(neighbor.id)}
                      disabled={isBtnLoading}
                      className={`h-8 px-3 rounded-full text-xs font-bold font-yrdly-body transition-all flex items-center gap-1 ${
                        isFollowing
                          ? "bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground hover:bg-white/10"
                          : "bg-primary text-black hover:opacity-90"
                      } disabled:opacity-50`}
                    >
                      {isFollowing ? (
                        <>
                          <Check className="w-3 h-3" /> Following
                        </>
                      ) : (
                        "Follow"
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[var(--yrdly-label)] py-2 font-yrdly-body">
              No new neighbors found nearby.
            </p>
          )}
        </GlassCard>
      )}

      {/* Widget 3: Nearby Events */}
      <GlassCard className="p-4 rounded-[20px] space-y-3">
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground font-yrdly-display">
              Upcoming Events
            </h3>
          </div>
          <Link
            href="/events"
            className="text-xs font-bold text-primary hover:underline font-yrdly-body flex items-center gap-1"
          >
            See all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {loadingEvents ? (
          <div className="space-y-3 pt-1">
            {[1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-14 h-14 rounded-xl" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length > 0 ? (
          <div className="space-y-3 pt-1">
            {events.map((event) => {
              const coverImg =
                event.image_urls?.[0] || event.cover_image_url || null;
              return (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="flex gap-3 items-center group p-2 rounded-xl transition-colors hover:bg-white/5"
                >
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-[var(--yrdly-glass-bg)] relative flex-shrink-0 border border-[var(--yrdly-glass-border)]">
                    {coverImg ? (
                      <Image
                        src={coverImg}
                        alt={event.title}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-primary font-bold text-xs font-yrdly-display">
                        EV
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground truncate font-yrdly-display group-hover:text-primary transition-colors">
                      {event.title}
                    </p>
                    {event.lga && (
                      <div className="flex items-center gap-1 text-xs text-[var(--yrdly-label)] mt-0.5 font-yrdly-body">
                        <MapPin className="w-3 h-3 text-primary" />
                        <span className="truncate">{event.lga}</span>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-[var(--yrdly-label)] py-2 font-yrdly-body">
            No upcoming events found.
          </p>
        )}
      </GlassCard>
    </aside>
  );
}
