"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserPlus, Search, MessageSquare, UserCheck, ShieldAlert, Sparkles, Store, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useFriendshipGlobal } from "@/hooks/use-friendship-global";
import { useLocation } from "@/contexts/LocationContext";
import { LocationChip } from "@/components/LocationChip";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

const GREEN = "hsl(var(--primary))";

type MainTab = "friends" | "discover";
type DiscoverFilter = "all" | "neighbors" | "mutuals" | "sellers";

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
          className="rounded-full px-5 py-1.5 text-xs font-extrabold transition-all active:scale-95 disabled:opacity-50 font-yrdly-display border border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary)]/10"
          disabled={isLoading}
        >
          {isLoading ? "..." : "Follow"}
        </button>
      );
    case "request_sent":
    case "friends":
      return (
        <button
          onClick={() => handleAction(friendshipHook.removeFriend)}
          className="rounded-full px-5 py-1.5 text-xs font-extrabold transition-all active:scale-95 disabled:opacity-50 font-yrdly-display bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground hover:border-red-500/40 hover:text-red-500 flex items-center gap-1"
          disabled={isLoading}
        >
          {isLoading ? "..." : "✓ Following"}
        </button>
      );
    case "request_received":
      return (
        <div className="flex gap-1.5">
          <button
            onClick={() => handleAction(friendshipHook.acceptRequest)}
            className="rounded-full px-4 py-1.5 text-xs text-black font-extrabold transition-all active:scale-95 disabled:opacity-50 font-yrdly-display"
            style={{ background: GREEN }}
            disabled={isLoading}
          >
            {isLoading ? "..." : "Accept"}
          </button>
        </div>
      );
  }
}

export function CommunityScreen({ className }: { className?: string }) {
  const { user: currentUser, profile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { activeFilter } = useLocation();

  const [activeTab, setActiveTab] = useState<MainTab>("discover");
  const [discoverFilter, setDiscoverFilter] = useState<DiscoverFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [friends, setFriends] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  
  const [neighbors, setNeighbors] = useState<any[]>([]);
  const [mutuals, setMutuals] = useState<any[]>([]);
  const [sellers, setSellers] = useState<any[]>([]);
  const [allDiscovered, setAllDiscovered] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // 1. Fetch Following & Followers from followers table
      const [{ data: followingData }, { data: followersData }] = await Promise.all([
        supabase
          .from("followers")
          .select("following_id, following:users!followers_following_id_fkey(id, name, avatar_url, location)")
          .eq("follower_id", currentUser.id),
        supabase
          .from("followers")
          .select("follower_id, follower:users!followers_follower_id_fkey(id, name, avatar_url, location)")
          .eq("following_id", currentUser.id),
      ]);

      const followingList = followingData || [];
      const followersList = followersData || [];

      const followingIds = new Set(followingList.map((f: any) => f.following_id));
      const followerIds = new Set(followersList.map((f: any) => f.follower_id));

      // Mutual Friends
      const friendList: any[] = [];
      followingList.forEach((f: any) => {
        if (followerIds.has(f.following_id) && f.following) {
          friendList.push({
            reqId: f.following_id,
            user: f.following,
          });
        }
      });

      // Incoming Requests (Users following me that I have not followed back)
      const reqList: any[] = [];
      followersList.forEach((f: any) => {
        if (!followingIds.has(f.follower_id) && f.follower) {
          reqList.push({
            id: f.follower_id,
            from_user: f.follower,
          });
        }
      });

      setFriends(friendList);
      setPendingRequests(reqList);

      // 3. Community discovery
      const targetLocation = activeFilter || profile?.location;
      let userQuery = supabase
        .from("users")
        .select("id, name, avatar_url, location, friends, discoverable")
        .neq("id", currentUser.id)
        .limit(100);

      if (targetLocation?.state) {
        userQuery = userQuery.contains("location", { state: targetLocation.state });
      }

      const { data: userData } = await userQuery;

      const blocked = profile?.blocked_users || [];
      const myFriendIds = friendList.map((f) => f.user.id);

      const discovered = (userData || [])
        .filter((u: any) => !blocked.includes(u.id))
        .filter((u: any) => !myFriendIds.includes(u.id))
        .filter((u: any) => !followingIds.has(u.id))
        .filter((u: any) => u.discoverable !== false);

      setAllDiscovered(discovered);

      const nearby = discovered.filter((u: any) => {
        if (!targetLocation?.lga) return true;
        return u.location?.lga === targetLocation.lga;
      });
      setNeighbors(nearby);

      const mutual = discovered.filter((u: any) => {
        const theirFriends = u.friends || [];
        return theirFriends.some((fid: string) => myFriendIds.includes(fid));
      });
      setMutuals(mutual);

      if (targetLocation?.state) {
        const { data: postData } = await supabase
          .from("posts")
          .select("user_id")
          .eq("category", "For Sale")
          .eq("is_sold", false)
          .eq("state", targetLocation.state)
          .limit(100);

        if (postData) {
          const sellerIds = Array.from(new Set(postData.map((p) => p.user_id)));
          setSellers(discovered.filter((u: any) => sellerIds.includes(u.id)));
        }
      }
    } catch (error) {
      console.error("Error fetching community data:", error);
    } finally {
      setLoading(false);
    }
  }, [currentUser, activeFilter, profile?.location, profile?.blocked_users]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      toast({ title: "Error", description: "Failed to open conversation.", variant: "destructive" });
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
    let list = allDiscovered;
    if (discoverFilter === "neighbors") list = neighbors;
    else if (discoverFilter === "mutuals") list = mutuals;
    else if (discoverFilter === "sellers") list = sellers;

    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((u) => u.name?.toLowerCase().includes(q));
  }, [allDiscovered, neighbors, mutuals, sellers, discoverFilter, searchQuery]);

  return (
    <div className={`min-h-[100dvh] pb-32 bg-[var(--yrdly-dark)] text-foreground ${className || ""}`}>
      <div className="max-w-2xl mx-auto px-yrdly-md pt-6 space-y-6">



        {/* ── Sub-Tab Segmented Switcher (Nearby vs My Circle - Mobile Parity) ── */}
        <div className="flex rounded-full p-1 border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-md">
          <button
            onClick={() => setActiveTab("discover")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-xs font-extrabold font-yrdly-display transition-all ${
              activeTab === "discover"
                ? "bg-[#82DB7E] text-black shadow-sm"
                : "text-[var(--yrdly-text-secondary)] hover:text-foreground font-medium"
            }`}
          >
            Nearby
          </button>
          <button
            onClick={() => setActiveTab("friends")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-xs font-extrabold font-yrdly-display transition-all ${
              activeTab === "friends"
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
        {activeTab === "discover" && (
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
                  className={`px-4 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap font-yrdly-display transition-all ${
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
        )}


        {/* ── Content Body ── */}
        {loading ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3, 4].map((i) => (
              <GlassCard key={i} className="flex items-center gap-3 p-3 rounded-2xl">
                <Skeleton className="w-12 h-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </GlassCard>
            ))}
          </div>
        ) : activeTab === "friends" ? (
          /* ── FRIENDS TAB ── */
          <div className="space-y-6">

            {/* Pending Friend Requests */}
            {pendingRequests.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-bold text-foreground tracking-wide uppercase font-yrdly-display">
                  Friend Requests ({pendingRequests.length})
                </h2>
                <div className="space-y-2">
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
                          <AvatarFallback style={{ background: GREEN, color: "#fff", fontWeight: 700 }}>
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
                        <UserActionButton userId={sender.id} onFriendAction={fetchData} />
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
                    {searchQuery ? "No matching friends for your search." : "Discover neighbors around you and build your local network!"}
                  </p>
                  {!searchQuery && (
                    <Button size="sm" onClick={() => setActiveTab("discover")} className="rounded-full font-yrdly-body">
                      Discover Neighbors
                    </Button>
                  )}
                </GlassCard>
              ) : (
                <div className="space-y-2">
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
                          <AvatarFallback style={{ background: GREEN, color: "#fff", fontWeight: 700 }}>
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
                          <UserActionButton userId={u.id} onFriendAction={fetchData} />
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
                    : "No discoverable users found in this category right now."}
                </p>
              </GlassCard>
            ) : (
              <div className="space-y-2">
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
                        <AvatarFallback style={{ background: GREEN, color: "#fff", fontWeight: 700 }}>
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
                      <UserActionButton userId={u.id} onFriendAction={fetchData} />
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