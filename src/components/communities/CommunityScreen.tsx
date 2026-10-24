"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserPlus, MessageSquare, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { useToast } from "@/hooks/use-toast";
import { useFriendshipGlobal } from "@/hooks/use-friendship-global";
import { useLocation } from "@/contexts/LocationContext";
import {
  boundedPeopleRequest,
  loadNearbyPeople,
  publicPerson,
  type PublicPerson,
  type DiscoverFilter,
} from "@/lib/people/nearby";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

const GREEN = "hsl(var(--primary))";

export type PeopleMode = "nearby" | "communities" | "circle";

// Helper component for user action buttons with real-time friendship status
function UserActionButton({
  userId,
  onFriendAction,
}: {
  userId: string;
  onFriendAction?: () => void;
}) {
  const friendshipHook = useFriendshipGlobal(userId);
  const status = friendshipHook.status;
  const isLoading = friendshipHook.isLoading;

  const handleAction = async (fn: () => Promise<void>) => {
    await fn();
    if (onFriendAction) onFriendAction();
  };

  switch (status) {
    case "none":
      return (
        <button
          onClick={() => handleAction(friendshipHook.addFriend)}
          className="rounded-full px-5 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 font-yrdly-display border border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary)]/10"
          disabled={isLoading}
        >
          {isLoading ? "..." : "Add Friend"}
        </button>
      );
    case "request_sent":
      return (
        <button
          className="rounded-full px-5 py-1.5 text-xs font-semibold font-yrdly-display bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground"
          disabled
        >
          Pending
        </button>
      );
    case "friends":
      return (
        <button
          onClick={() => handleAction(friendshipHook.removeFriend)}
          className="rounded-full px-5 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 font-yrdly-display bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground hover:border-red-500/40 hover:text-red-500 flex items-center gap-1"
          disabled={isLoading}
        >
          {isLoading ? "..." : "✓ Friends"}
        </button>
      );
    case "request_received":
      return (
        <div className="flex gap-1.5">
          <button
            onClick={() => handleAction(friendshipHook.acceptRequest)}
            className="rounded-full px-4 py-1.5 text-xs text-black font-semibold transition-all active:scale-95 disabled:opacity-50 font-yrdly-display"
            style={{ background: GREEN }}
            disabled={isLoading}
          >
            {isLoading ? "..." : "Accept"}
          </button>
        </div>
      );
  }
}

export function CommunityScreen({
  className,
  mode,
  onModeChange,
  communitiesContent,
}: {
  className?: string;
  mode?: PeopleMode;
  onModeChange?: (mode: PeopleMode) => void;
  communitiesContent?: ReactNode;
}) {
  const { user: currentUser, profile, loading: authLoading, updateProfile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { activeFilter } = useLocation();
  const [localMode, setLocalMode] = useState<PeopleMode>("nearby");
  const activeMode = mode ?? localMode;
  const [visitedCommunities, setVisitedCommunities] = useState(
    activeMode === "communities",
  );
  useEffect(() => {
    if (activeMode === "communities") setVisitedCommunities(true);
  }, [activeMode]);
  const setMode = (next: PeopleMode) => {
    setLocalMode(next);
    onModeChange?.(next);
  };
  const [discoverFilter, setDiscoverFilter] = useState<DiscoverFilter>("all");
  const [searchQuery] = useState("");
  const [friends, setFriends] = useState<
    { reqId: string; user: PublicPerson }[]
  >([]);
  const [pendingRequests, setPendingRequests] = useState<
    { id: string; from_user: PublicPerson }[]
  >([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [allDiscovered, setAllDiscovered] = useState<PublicPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [circleLoading, setCircleLoading] = useState(true);
  const [error, setError] = useState(false);
  const [circleError, setCircleError] = useState(false);
  const [revision, setRevision] = useState(0);
  const fetchData = useCallback(() => setRevision((value) => value + 1), []);
  const [nearbyCoordinates, setNearbyCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [radiusMeters, setRadiusMeters] = useState(10000);
  const locationRequestInProgress = useRef(false);
  const userId = currentUser?.id;
  const updateNearbyLocation = useCallback(async () => {
    if (locationRequestInProgress.current) return;
    locationRequestInProgress.current = true;
    setLocationBusy(true);
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Location is unavailable in this browser.");
      setLocationBusy(false);
      locationRequestInProgress.current = false;
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const { error } = await supabase.rpc("upsert_nearby_presence", {
            p_latitude: coords.latitude,
            p_longitude: coords.longitude,
          });
          if (error) throw error;
          setNearbyCoordinates({
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
        } catch {
          setLocationError("Could not enable Nearby. Please try again.");
        } finally {
          setLocationBusy(false);
          locationRequestInProgress.current = false;
        }
      },
      () => {
        setLocationError("Allow location access in your browser to find people nearby.");
        setLocationBusy(false);
        locationRequestInProgress.current = false;
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 },
    );
  }, []);

  const enableNearby = useCallback(async () => {
    if (!profile?.nearby_enabled) {
      try {
        if (!userId) return;
        await updateProfile({ nearby_enabled: true });
        await updateNearbyLocation();
      } catch {
        setLocationError("Could not enable Nearby. Please try again.");
      }
    } else {
      await updateNearbyLocation();
    }
  }, [profile?.nearby_enabled, updateNearbyLocation, updateProfile, userId]);

  useEffect(() => {
    if (activeMode === "nearby" && profile?.nearby_enabled && !nearbyCoordinates) {
      void updateNearbyLocation();
    }
  }, [activeMode, profile?.nearby_enabled, nearbyCoordinates, updateNearbyLocation]);

  useEffect(() => {
    if (activeMode !== "nearby" || !nearbyCoordinates) return;
    void supabase.rpc("upsert_nearby_presence", {
      p_latitude: nearbyCoordinates.latitude,
      p_longitude: nearbyCoordinates.longitude,
    });
    const timer = window.setInterval(() => {
      void supabase.rpc("upsert_nearby_presence", {
        p_latitude: nearbyCoordinates.latitude,
        p_longitude: nearbyCoordinates.longitude,
      });
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [activeMode, nearbyCoordinates]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setFriends([]);
    setPendingRequests([]);
    setFollowingIds([]);
    setCircleError(false);
    if (!userId || authLoading) {
      setCircleLoading(!!authLoading);
      return;
    }
    setCircleLoading(true);
    void boundedPeopleRequest(controller, async (signal) => {
      const [following, followers] = await Promise.all([
        supabase
          .from("followers")
          .select(
            "following_id, following:public_profiles!followers_following_id_fkey(id, name, avatar_url, location)",
          )
          .eq("follower_id", userId)
          .abortSignal(signal),
        supabase
          .from("followers")
          .select(
            "follower_id, follower:public_profiles!followers_follower_id_fkey(id, name, avatar_url, location)",
          )
          .eq("following_id", userId)
          .abortSignal(signal),
      ]);
      if (
        following.error ||
        followers.error ||
        !Array.isArray(following.data) ||
        !Array.isArray(followers.data)
      )
        throw new Error("Unable to load your circle");
      const outgoing = new Set<string>(
        following.data.map((row) => row.following_id),
      );
      const incoming = new Set<string>(
        followers.data.map((row) => row.follower_id),
      );
      const friends = following.data.flatMap((row) => {
        const person = publicPerson(
          Array.isArray(row.following) ? row.following[0] : row.following,
        );
        return person && incoming.has(row.following_id)
          ? [{ reqId: row.following_id, user: person }]
          : [];
      });
      const requests = followers.data.flatMap((row) => {
        const person = publicPerson(
          Array.isArray(row.follower) ? row.follower[0] : row.follower,
        );
        return person && !outgoing.has(row.follower_id)
          ? [{ id: row.follower_id, from_user: person }]
          : [];
      });
      return { friends, requests, outgoing: [...outgoing] };
    })
      .then((result) => {
        if (disposed) return;
        setFriends(result.friends);
        setPendingRequests(result.requests);
        setFollowingIds(result.outgoing);
      })
      .catch(() => {
        if (!disposed) setCircleError(true);
      })
      .finally(() => {
        if (!disposed) setCircleLoading(false);
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [userId, authLoading, revision]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setAllDiscovered([]);
    setError(false);
    if (!userId || authLoading) {
      setLoading(!!authLoading);
      return;
    }
    if (activeMode !== "nearby" || !profile?.nearby_enabled || !nearbyCoordinates) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void boundedPeopleRequest(controller, (signal) =>
      loadNearbyPeople(supabase, {
        coordinates: nearbyCoordinates,
        radiusMeters,
        filter: discoverFilter,
        signal,
      }),
    )
      .then((people) => {
        if (!disposed) setAllDiscovered(people);
      })
      .catch(() => {
        if (!disposed) setError(true);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [userId, authLoading, discoverFilter, nearbyCoordinates, radiusMeters, activeMode, profile?.nearby_enabled, revision]);

  useEffect(() => {
    if (!currentUser) return;

    const channel = supabase
      .channel(`community-requests:${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "followers",
          filter: `following_id=eq.${currentUser.id}`,
        },
        () => fetchData(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, fetchData]);

  const handleMessageFriend = async (friendId: string) => {
    if (!currentUser) return;
    try {
      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .eq("type", "friend")
        .contains("participant_ids", [currentUser.id, friendId])
        .limit(1)
        .maybeSingle();

      if (existing) {
        router.push(`/messages/${existing.id}`);
      } else {
        const { data: newConv, error } = await supabase
          .from("conversations")
          .insert({
            type: "friend",
            participant_ids: [currentUser.id, friendId],
          })
          .select()
          .single();

        if (error) throw error;
        if (newConv) router.push(`/messages/${newConv.id}`);
      }
    } catch (error) {
      console.error("Error starting chat:", error);
      toast({
        title: "Error",
        description: "Failed to open conversation.",
        variant: "destructive",
      });
    }
  };

  const getLocationString = (loc: any): string => {
    if (!loc || typeof loc !== "object") return "";
    if (loc.lga && loc.state) return `${loc.lga}, ${loc.state}`;
    if (loc.state) return loc.state;
    return "";
  };

  // Search filtering
  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase();
    return friends.filter((f) => f.user?.name?.toLowerCase().includes(q));
  }, [friends, searchQuery]);

  const displayedDiscoverList = useMemo(() => {
    const blocked = Array.isArray(profile?.blocked_users)
      ? profile.blocked_users
      : [];
    const list = allDiscovered.filter(
      (person) =>
        !blocked.includes(person.id) && !followingIds.includes(person.id),
    );
    if (!searchQuery.trim()) return list;
    return list.filter((person) =>
      person.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [allDiscovered, followingIds, profile?.blocked_users, searchQuery]);

  return (
    <div
      className={`min-h-[100dvh] pb-32 bg-[var(--yrdly-dark)] text-foreground ${className || ""}`}
    >
      <div className="max-w-none w-full px-yrdly-md pt-6 space-y-6">
        {/* ── Sub-Tab Segmented Switcher (Nearby vs My Circle - Mobile Parity) ── */}
        <div className="flex rounded-full p-1 border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-md">
          <button
            onClick={() => setMode("nearby")}
            aria-pressed={activeMode === "nearby"}
            className={`min-h-11 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-xs font-semibold font-yrdly-display transition-all ${
              activeMode === "nearby"
                ? "bg-[#82DB7E] text-black shadow-sm"
                : "text-[var(--yrdly-text-secondary)] hover:text-foreground font-medium"
            }`}
          >
            Nearby
          </button>
          <button
            onClick={() => setMode("communities")}
            aria-pressed={activeMode === "communities"}
            className={`min-h-11 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-xs font-semibold font-yrdly-display transition-all ${activeMode === "communities" ? "bg-[#82DB7E] text-black shadow-sm" : "text-[var(--yrdly-text-secondary)] hover:text-foreground font-medium"}`}
          >
            Communities
          </button>
          <button
            onClick={() => setMode("circle")}
            aria-pressed={activeMode === "circle"}
            className={`min-h-11 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-xs font-semibold font-yrdly-display transition-all ${
              activeMode === "circle"
                ? "bg-[#82DB7E] text-black shadow-sm"
                : "text-[var(--yrdly-text-secondary)] hover:text-foreground font-medium"
            }`}
          >
            My circle
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
            {friends.length > 0 && <span>({friends.length})</span>}
          </button>
        </div>

        {/* ── Sub-Filters Chips (When Nearby active) ── */}
        {activeMode === "nearby" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {[
                { key: "all", label: "All" },
                { key: "neighbors", label: "Neighbors" },
                { key: "mutuals", label: "Mutuals" },
                { key: "sellers", label: "Sellers" },
              ].map((f) => {
                const active = discoverFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setDiscoverFilter(f.key as DiscoverFilter)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap font-yrdly-display transition-all ${
                      active
                        ? "border border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10"
                        : "bg-[var(--yrdly-glass-bg)] text-[var(--yrdly-text-primary)] border border-[var(--yrdly-glass-border)] hover:border-primary/40"
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Within</span>
              {[5000, 10000, 25000].map((radius) => (
                <button
                  key={radius}
                  onClick={() => setRadiusMeters(radius)}
                  aria-pressed={radiusMeters === radius}
                  className={`rounded-full px-3 py-1 border ${radiusMeters === radius ? "border-primary text-primary" : "border-[var(--yrdly-glass-border)]"}`}
                >
                  {radius / 1000} km
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Content Body ── */}
        {(visitedCommunities || activeMode === "communities") && (
          <div hidden={activeMode !== "communities"}>{communitiesContent}</div>
        )}
        {activeMode === "communities" ? null : !authLoading && !currentUser ? (
          <p className="py-8 text-center text-sm">
            Sign in to discover people nearby.
          </p>
        ) : (activeMode === "circle" ? circleLoading : loading) ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3, 4].map((i) => (
              <GlassCard
                key={i}
                className="flex items-center gap-3 p-3 rounded-2xl"
              >
                <Skeleton className="w-12 h-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </GlassCard>
            ))}
          </div>
        ) : activeMode === "nearby" && !profile?.nearby_enabled ? (
          <GlassCard className="space-y-3 rounded-2xl p-5 text-center">
            <MapPin className="mx-auto h-7 w-7 text-primary" />
            <p className="font-semibold">Find people near you</p>
            <p className="text-sm text-muted-foreground">Share your current location while using Nearby. It expires after 30 minutes, and other members never see your exact coordinates.</p>
            <Button onClick={() => void enableNearby()} disabled={locationBusy} className="min-h-11 rounded-full">
              {locationBusy ? "Getting location…" : "Enable Nearby"}
            </Button>
            {locationError && <p role="alert" className="text-sm text-destructive">{locationError}</p>}
          </GlassCard>
        ) : activeMode === "nearby" && !nearbyCoordinates ? (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">{locationError || "Allow location access to find opted-in people within your chosen radius."}</p>
            <Button onClick={() => void enableNearby()} disabled={locationBusy} className="min-h-11 rounded-full">
              {locationBusy ? "Getting location…" : "Try location access again"}
            </Button>
          </div>
        ) : (activeMode === "circle" ? circleError : error) ? (
          <div role="alert" className="space-y-3 py-8 text-center">
            <p className="text-sm">
              We couldn&apos;t load{" "}
              {activeMode === "circle" ? "your circle" : "nearby people"}.
              Please try again.
            </p>
            <Button onClick={fetchData} className="min-h-11 rounded-full">
              Retry
            </Button>
          </div>
        ) : activeMode === "circle" ? (
          /* ── FRIENDS TAB ── */
          <div className="space-y-6">
            {/* Pending Friend Requests */}
            {pendingRequests.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-bold text-foreground tracking-wide uppercase font-yrdly-display">
                  Friend Requests ({pendingRequests.length})
                </h2>
                <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-2">
                  {pendingRequests.map((req) => {
                    const sender = req.from_user;
                    if (!sender) return null;
                    const loc = getLocationString(sender.location);
                    return (
                      <GlassCard
                        key={req.id}
                        className="rounded-2xl"
                        contentClassName="flex items-center justify-between gap-3 p-3.5 w-full"
                      >
                        <Avatar
                          className="w-12 h-12 cursor-pointer"
                          onClick={() => router.push(`/profile/${sender.id}`)}
                        >
                          <AvatarImage src={sender.avatar_url} />
                          <AvatarFallback
                            style={{
                              background: GREEN,
                              color: "#fff",
                              fontWeight: 700,
                            }}
                          >
                            {sender.name?.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm font-semibold text-foreground truncate cursor-pointer hover:underline font-yrdly-display"
                            onClick={() => router.push(`/profile/${sender.id}`)}
                          >
                            {sender.name}
                          </p>
                          {loc && (
                            <p className="text-xs text-[var(--yrdly-label)] truncate font-yrdly-body">
                              {loc}
                            </p>
                          )}
                        </div>
                        <UserActionButton
                          userId={sender.id}
                          onFriendAction={fetchData}
                        />
                      </GlassCard>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Friends List */}
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-foreground tracking-wide uppercase font-yrdly-display">
                My Friends ({filteredFriends.length})
              </h2>

              {filteredFriends.length === 0 ? (
                <GlassCard className="flex flex-col items-center justify-center py-12 text-center rounded-3xl p-6">
                  <Users className="w-10 h-10 text-[var(--yrdly-label)] mb-3 opacity-40" />
                  <h3 className="text-sm font-semibold text-foreground mb-1 font-yrdly-display">
                    No friends found
                  </h3>
                  <p className="text-xs text-[var(--yrdly-label)] max-w-xs mb-4 font-yrdly-body">
                    {searchQuery
                      ? "No matching friends for your search."
                      : "Discover neighbors around you and build your local network!"}
                  </p>
                  {!searchQuery && (
                    <Button
                      size="sm"
                      onClick={() => setMode("nearby")}
                      className="rounded-full font-yrdly-body"
                    >
                      Discover Neighbors
                    </Button>
                  )}
                </GlassCard>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-2">
                  {filteredFriends.map((friend) => {
                    const u = friend.user;
                    if (!u) return null;
                    const loc = getLocationString(u.location);
                    return (
                      <GlassCard
                        key={friend.reqId}
                        className="rounded-2xl transition-all hover:border-primary/40"
                        contentClassName="flex items-center justify-between gap-3 p-3.5 w-full"
                      >
                        <Avatar
                          className="w-12 h-12 cursor-pointer"
                          onClick={() => router.push(`/profile/${u.id}`)}
                        >
                          <AvatarImage src={u.avatar_url} />
                          <AvatarFallback
                            style={{
                              background: GREEN,
                              color: "#fff",
                              fontWeight: 700,
                            }}
                          >
                            {u.name?.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm font-semibold text-foreground truncate cursor-pointer hover:underline font-yrdly-display"
                            onClick={() => router.push(`/profile/${u.id}`)}
                          >
                            {u.name}
                          </p>
                          {loc && (
                            <p className="text-xs text-[var(--yrdly-label)] truncate font-yrdly-body">
                              {loc}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleMessageFriend(u.id)}
                            className="p-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            title="Message Friend"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>
                          <UserActionButton
                            userId={u.id}
                            onFriendAction={fetchData}
                          />
                        </div>
                      </GlassCard>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* ── DISCOVER TAB ── */
          <div className="space-y-4">
            {/* Discovered Users List */}
            {displayedDiscoverList.length === 0 ? (
              <GlassCard className="flex flex-col items-center justify-center py-12 text-center rounded-3xl p-6">
                <UserPlus className="w-10 h-10 text-[var(--yrdly-label)] mb-3 opacity-40" />
                <h3 className="text-sm font-semibold text-foreground mb-1 font-yrdly-display">
                  No neighbors found
                </h3>
                <p className="text-xs text-[var(--yrdly-label)] max-w-xs font-yrdly-body">
                  {searchQuery
                    ? "No neighbors matching your query."
                    : !profile?.nearby_enabled || !nearbyCoordinates
                      ? "Enable Nearby and allow location access to find people within your chosen radius."
                      : "No opted-in people within this radius right now."}
                </p>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-2">
                {displayedDiscoverList.map((u) => {
                  const loc = getLocationString(u.location);
                  return (
                    <GlassCard
                      key={u.id}
                      className="rounded-2xl transition-all hover:border-primary/40"
                      contentClassName="flex items-center justify-between gap-3 p-3.5 w-full"
                    >
                      <Avatar
                        className="w-12 h-12 cursor-pointer"
                        onClick={() => router.push(`/profile/${u.id}`)}
                      >
                        <AvatarImage src={u.avatar_url} />
                        <AvatarFallback
                          style={{
                            background: GREEN,
                            color: "#fff",
                            fontWeight: 700,
                          }}
                        >
                          {u.name?.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-semibold text-foreground truncate cursor-pointer hover:underline font-yrdly-display"
                          onClick={() => router.push(`/profile/${u.id}`)}
                        >
                          {u.name}
                        </p>
                        {loc && (
                          <p className="flex items-center gap-1 text-xs text-[var(--yrdly-label)] truncate font-yrdly-body mt-0.5">
                            <MapPin className="w-3 h-3 text-[var(--yrdly-label)] shrink-0" />
                            <span>{loc}</span>
                          </p>
                        )}
                      </div>
                      <UserActionButton
                        userId={u.id}
                        onFriendAction={fetchData}
                      />
                    </GlassCard>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
