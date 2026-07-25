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

const GREEN = "hsl(var(--primary))";
const FONT = "var(--font-work-sans)";
const PACIFICO = "var(--font-jersey25)";

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
          className="rounded-full px-4 py-1.5 text-xs text-foreground font-bold uppercase transition-transform active:scale-95 disabled:opacity-50"
          style={{ background: GREEN, fontFamily: FONT }}
          disabled={isLoading}
        >
          {isLoading ? "..." : "Add"}
        </button>
      );
    case "request_sent":
      return (
        <button
          className="rounded-full px-4 py-1.5 text-xs text-[#BBBBBB] font-bold uppercase"
          style={{ border: "1px solid #388E3C", fontFamily: FONT }}
          disabled
        >
          Sent
        </button>
      );
    case "friends":
      return (
        <button
          onClick={() => handleAction(friendshipHook.removeFriend)}
          className="rounded-full px-4 py-1.5 text-xs font-bold uppercase transition-transform active:scale-95 disabled:opacity-50"
          style={{ border: "1px solid rgba(229,57,53,0.4)", color: "#E53935", fontFamily: FONT }}
          disabled={isLoading}
        >
          {isLoading ? "..." : "Remove"}
        </button>
      );
    case "request_received":
      return (
        <div className="flex gap-1.5">
          <button
            onClick={() => handleAction(friendshipHook.acceptRequest)}
            className="rounded-full px-3 py-1 text-xs text-foreground font-bold uppercase transition-transform active:scale-95 disabled:opacity-50"
            style={{ background: GREEN, fontFamily: FONT }}
            disabled={isLoading}
          >
            {isLoading ? "..." : "Accept"}
          </button>
          <button
            onClick={() => handleAction(friendshipHook.declineRequest)}
            className="rounded-full px-3 py-1 text-xs font-bold uppercase transition-transform active:scale-95 disabled:opacity-50"
            style={{ border: "1px solid rgba(229,57,53,0.4)", color: "#E53935", fontFamily: FONT }}
            disabled={isLoading}
          >
            {isLoading ? "..." : "Decline"}
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

  const [activeTab, setActiveTab] = useState<MainTab>("friends");
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
      // 1. Pending friend requests
      const { data: reqData } = await supabase
        .from("friend_requests")
        .select(`*, from_user:users!friend_requests_from_user_id_fkey(id, name, avatar_url, location)`)
        .eq("to_user_id", currentUser.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      setPendingRequests(reqData || []);

      // 2. Accepted friends (both directions)
      const [{ data: sentFriends }, { data: receivedFriends }] = await Promise.all([
        supabase
          .from("friend_requests")
          .select(`id, to_user:users!friend_requests_to_user_id_fkey(id, name, avatar_url, location)`)
          .eq("from_user_id", currentUser.id)
          .eq("status", "accepted"),
        supabase
          .from("friend_requests")
          .select(`id, from_user:users!friend_requests_from_user_id_fkey(id, name, avatar_url, location)`)
          .eq("to_user_id", currentUser.id)
          .eq("status", "accepted"),
      ]);

      const friendList = [
        ...(sentFriends || []).map((r: any) => ({ reqId: r.id, user: r.to_user })),
        ...(receivedFriends || []).map((r: any) => ({ reqId: r.id, user: r.from_user })),
      ].filter((f) => f.user);
      setFriends(friendList);

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

      // Also query pending sent requests so sent request recipients are excluded from Discover list
      const { data: pendingSent } = await supabase
        .from("friend_requests")
        .select("to_user_id")
        .eq("from_user_id", currentUser.id)
        .eq("status", "pending");

      const pendingSentTargetIds = (pendingSent || []).map((r: any) => r.to_user_id);

      const blocked = profile?.blocked_users || [];
      const myFriendIds = friendList.map((f) => f.user.id);

      const discovered = (userData || [])
        .filter((u: any) => !blocked.includes(u.id))
        .filter((u: any) => !myFriendIds.includes(u.id))
        .filter((u: any) => !pendingSentTargetIds.includes(u.id))
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
        router.push(`/messages?conversationId=${existing.id}`);
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
        if (newConv) router.push(`/messages?conversationId=${newConv.id}`);
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
    <div className={`min-h-[100dvh] pb-32 ${className || ""}`} style={{ background: "var(--c-bg)" }}>
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">

        {/* ── Header ── */}
        <header className="space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="text-[1.35rem] text-foreground font-bold" style={{ fontFamily: PACIFICO }}>
              Community
            </h1>
            <LocationChip />
          </div>
          <p className="text-xs text-muted-foreground" style={{ fontFamily: FONT }}>
            Connect with your neighbors and manage your friends list
          </p>
        </header>

        {/* ── Top Tabs (Friends | Discover) ── */}
        <div className="flex rounded-full p-1 border border-border bg-[var(--c-card2)]">
          <button
            onClick={() => setActiveTab("friends")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === "friends"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            <Users className="w-4 h-4" />
            Friends ({friends.length})
            {pendingRequests.length > 0 && (
              <span className="ml-1 bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full">
                {pendingRequests.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("discover")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === "discover"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            <UserPlus className="w-4 h-4" />
            Discover
          </button>
        </div>

        {/* ── Search Bar ── */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={activeTab === "friends" ? "Search friends..." : "Search neighbors..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-full px-4 pl-10 py-3 text-xs text-foreground bg-[var(--c-card)] border border-border outline-none focus:ring-1 focus:ring-primary"
            style={{ fontFamily: FONT }}
          />
        </div>

        {/* ── Content Body ── */}
        {loading ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--c-card)] border border-border">
                <Skeleton className="w-12 h-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === "friends" ? (
          /* ── FRIENDS TAB ── */
          <div className="space-y-6">

            {/* Pending Friend Requests */}
            {pendingRequests.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-bold text-foreground tracking-wide uppercase" style={{ fontFamily: FONT }}>
                  Friend Requests ({pendingRequests.length})
                </h2>
                <div className="space-y-2">
                  {pendingRequests.map((req) => {
                    const sender = req.from_user;
                    if (!sender) return null;
                    const loc = getLocationString(sender.location);
                    return (
                      <div
                        key={req.id}
                        className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--c-card)] border border-border"
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
                            className="text-sm font-semibold text-foreground truncate cursor-pointer hover:underline"
                            onClick={() => router.push(`/profile/${sender.id}`)}
                            style={{ fontFamily: FONT }}
                          >
                            {sender.name}
                          </p>
                          {loc && (
                            <p className="text-xs text-muted-foreground truncate" style={{ fontFamily: FONT }}>
                              {loc}
                            </p>
                          )}
                        </div>
                        <UserActionButton userId={sender.id} onFriendAction={fetchData} />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Friends List */}
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-foreground tracking-wide uppercase" style={{ fontFamily: FONT }}>
                My Friends ({filteredFriends.length})
              </h2>

              {filteredFriends.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center bg-[var(--c-card)] rounded-3xl border border-border p-6">
                  <Users className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
                  <h3 className="text-sm font-semibold text-foreground mb-1" style={{ fontFamily: FONT }}>
                    No friends found
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-xs mb-4" style={{ fontFamily: FONT }}>
                    {searchQuery ? "No matching friends for your search." : "Discover neighbors around you and build your local network!"}
                  </p>
                  {!searchQuery && (
                    <Button size="sm" onClick={() => setActiveTab("discover")} className="rounded-full">
                      Discover Neighbors
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredFriends.map((friend) => {
                    const u = friend.user;
                    if (!u) return null;
                    const loc = getLocationString(u.location);
                    return (
                      <div
                        key={friend.reqId}
                        className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--c-card)] border border-border transition-all hover:border-primary/40"
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
                            className="text-sm font-semibold text-foreground truncate cursor-pointer hover:underline"
                            onClick={() => router.push(`/profile/${u.id}`)}
                            style={{ fontFamily: FONT }}
                          >
                            {u.name}
                          </p>
                          {loc && (
                            <p className="text-xs text-muted-foreground truncate" style={{ fontFamily: FONT }}>
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
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* ── DISCOVER TAB ── */
          <div className="space-y-4">
            {/* Sub-Filters */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {[
                { key: "all", label: "All Neighbors", icon: Users },
                { key: "neighbors", label: "Nearby", icon: MapPin },
                { key: "mutuals", label: "Mutuals", icon: Sparkles },
                { key: "sellers", label: "Sellers", icon: Store },
              ].map((f) => {
                const Icon = f.icon;
                const active = discoverFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setDiscoverFilter(f.key as DiscoverFilter)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-[var(--c-card)] text-muted-foreground border border-border hover:text-foreground"
                    }`}
                    style={{ fontFamily: FONT }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {f.label}
                  </button>
                );
              })}
            </div>

            {/* Discovered Users List */}
            {displayedDiscoverList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center bg-[var(--c-card)] rounded-3xl border border-border p-6">
                <UserPlus className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
                <h3 className="text-sm font-semibold text-foreground mb-1" style={{ fontFamily: FONT }}>
                  No neighbors found
                </h3>
                <p className="text-xs text-muted-foreground max-w-xs" style={{ fontFamily: FONT }}>
                  {searchQuery
                    ? "No neighbors matching your query."
                    : "No discoverable users found in this category right now."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {displayedDiscoverList.map((u) => {
                  const loc = getLocationString(u.location);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--c-card)] border border-border transition-all hover:border-primary/40"
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
                          className="text-sm font-semibold text-foreground truncate cursor-pointer hover:underline"
                          onClick={() => router.push(`/profile/${u.id}`)}
                          style={{ fontFamily: FONT }}
                        >
                          {u.name}
                        </p>
                        {loc && (
                          <p className="text-xs text-muted-foreground truncate" style={{ fontFamily: FONT }}>
                            {loc}
                          </p>
                        )}
                      </div>
                      <UserActionButton userId={u.id} onFriendAction={fetchData} />
                    </div>
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