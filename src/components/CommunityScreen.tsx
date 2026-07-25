"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Search, MessageSquare, UserPlus, UserCheck, UserX, ShieldCheck, MapPin, Store, User } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "@/contexts/LocationContext";
import { LocationChip } from "@/components/LocationChip";

type Tab = "friends" | "discover";
type DiscoverFilter = "all" | "neighbors" | "mutuals" | "sellers";

export function CommunityScreen() {
  const { user: currentUser, profile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { activeFilter } = useLocation();

  const [activeTab, setActiveTab] = useState<Tab>("friends");
  const [discoverFilter, setDiscoverFilter] = useState<DiscoverFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<any[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [neighbors, setNeighbors] = useState<any[]>([]);
  const [mutuals, setMutuals] = useState<any[]>([]);
  const [sellers, setSellers] = useState<any[]>([]);
  const [allDiscover, setAllDiscover] = useState<any[]>([]);
  const [actionInProgress, setActionInProgress] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // 1. Pending Friend Requests
      const { data: reqData } = await supabase
        .from("friend_requests")
        .select(`*, from_user:users!friend_requests_from_user_id_fkey(id, name, avatar_url, location)`)
        .eq("to_user_id", currentUser.id)
        .eq("status", "pending");
      setRequests(reqData || []);

      // 2. Accepted Friends (Both directions)
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

      // 3. Community Discover Users
      const targetLocation = activeFilter || profile?.location;
      let userQuery = supabase
        .from("users")
        .select("id, name, avatar_url, location, friends, discoverable, verified_seller")
        .neq("id", currentUser.id)
        .limit(100);

      if (targetLocation?.state) {
        userQuery = userQuery.contains("location", { state: targetLocation.state });
      }

      const { data: userData } = await userQuery;
      const blocked = profile?.blocked_users || [];
      const myFriendIds = friendList.map((f) => f.user.id);

      const discoveredUsers = (userData || [])
        .filter((u) => !blocked.includes(u.id))
        .filter((u) => !myFriendIds.includes(u.id))
        .filter((u) => u.discoverable !== false);

      setAllDiscover(discoveredUsers);

      const nearbyUsers = discoveredUsers.filter((u) => {
        if (!targetLocation?.lga) return true;
        return u.location?.lga === targetLocation.lga;
      });
      setNeighbors(nearbyUsers);

      const mutualUsers = discoveredUsers.filter((u) => {
        const theirFriends = u.friends || [];
        return theirFriends.some((fid: string) => myFriendIds.includes(fid));
      });
      setMutuals(mutualUsers);

      let activeSellers: any[] = [];
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
          activeSellers = discoveredUsers.filter((u) => sellerIds.includes(u.id));
        }
      }
      setSellers(activeSellers);
    } catch (e) {
      console.error("Error fetching community data:", e);
    } finally {
      setLoading(false);
    }
  }, [currentUser, activeFilter, profile?.blocked_users, profile?.location]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle Accepting / Declining Friend Request with Users.friends array sync
  const handleRequestAction = async (requestId: string, action: "accepted" | "declined") => {
    if (!currentUser) return;
    setActionInProgress((prev) => ({ ...prev, [requestId]: true }));
    try {
      if (action === "accepted") {
        const { data: req } = await supabase
          .from("friend_requests")
          .select("from_user_id, to_user_id")
          .eq("id", requestId)
          .single();

        await supabase
          .from("friend_requests")
          .update({ status: "accepted" })
          .eq("id", requestId);

        if (req) {
          // Sync users.friends for both participants
          const [{ data: u1 }, { data: u2 }] = await Promise.all([
            supabase.from("users").select("friends").eq("id", req.from_user_id).single(),
            supabase.from("users").select("friends").eq("id", req.to_user_id).single(),
          ]);

          const u1Friends = Array.from(new Set([...(u1?.friends || []), req.to_user_id]));
          const u2Friends = Array.from(new Set([...(u2?.friends || []), req.from_user_id]));

          await Promise.all([
            supabase.from("users").update({ friends: u1Friends }).eq("id", req.from_user_id),
            supabase.from("users").update({ friends: u2Friends }).eq("id", req.to_user_id),
          ]);
        }

        toast({ title: "Friend Request Accepted!" });
      } else {
        await supabase.from("friend_requests").delete().eq("id", requestId);
        toast({ title: "Friend Request Declined" });
      }
      fetchData();
    } catch (e) {
      console.error("Error in request action:", e);
      toast({ title: "Action failed", variant: "destructive" });
    } finally {
      setActionInProgress((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  // Handle Remove Friend with Users.friends array sync
  const handleRemoveFriend = async (reqId: string, friendId: string, friendName: string) => {
    if (!currentUser) return;
    if (!confirm(`Remove ${friendName} from your friends?`)) return;

    setActionInProgress((prev) => ({ ...prev, [reqId]: true }));
    try {
      await supabase.from("friend_requests").delete().eq("id", reqId);

      const [{ data: u1 }, { data: u2 }] = await Promise.all([
        supabase.from("users").select("friends").eq("id", currentUser.id).single(),
        supabase.from("users").select("friends").eq("id", friendId).single(),
      ]);

      const u1Friends = (u1?.friends || []).filter((id: string) => id !== friendId);
      const u2Friends = (u2?.friends || []).filter((id: string) => id !== currentUser.id);

      await Promise.all([
        supabase.from("users").update({ friends: u1Friends }).eq("id", currentUser.id),
        supabase.from("users").update({ friends: u2Friends }).eq("id", friendId),
      ]);

      toast({ title: `Removed ${friendName}` });
      fetchData();
    } catch (e) {
      console.error("Error removing friend:", e);
      toast({ title: "Failed to remove friend", variant: "destructive" });
    } finally {
      setActionInProgress((prev) => ({ ...prev, [reqId]: false }));
    }
  };

  // Handle Send Friend Request
  const handleSendRequest = async (targetUserId: string) => {
    if (!currentUser) return;
    setActionInProgress((prev) => ({ ...prev, [targetUserId]: true }));
    try {
      const { data: existing } = await supabase
        .from("friend_requests")
        .select("id, status")
        .or(
          `and(from_user_id.eq.${currentUser.id},to_user_id.eq.${targetUserId}),` +
          `and(from_user_id.eq.${targetUserId},to_user_id.eq.${currentUser.id})`
        )
        .maybeSingle();

      if (!existing) {
        await supabase.from("friend_requests").insert({
          from_user_id: currentUser.id,
          to_user_id: targetUserId,
          status: "pending",
        });
        toast({ title: "Friend Request Sent!" });
        fetchData();
      }
    } catch (e) {
      console.error("Error sending request:", e);
      toast({ title: "Could not send request", variant: "destructive" });
    } finally {
      setActionInProgress((prev) => ({ ...prev, [targetUserId]: false }));
    }
  };

  // Start Chat with Friend
  const handleStartChat = async (friendUserId: string) => {
    if (!currentUser) return;
    try {
      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .eq("type", "friend")
        .contains("participant_ids", [currentUser.id, friendUserId])
        .maybeSingle();

      if (existing) {
        router.push(`/messages?chat=${existing.id}`);
      } else {
        const { data: newConv } = await supabase
          .from("conversations")
          .insert({
            type: "friend",
            participant_ids: [currentUser.id, friendUserId],
          })
          .select("id")
          .single();

        if (newConv) {
          router.push(`/messages?chat=${newConv.id}`);
        }
      }
    } catch (e) {
      console.error("Error starting chat:", e);
    }
  };

  // Filtered lists by Search Query
  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return requests;
    const q = searchQuery.toLowerCase();
    return requests.filter((r) => r.from_user?.name?.toLowerCase().includes(q));
  }, [requests, searchQuery]);

  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase();
    return friends.filter((f) => f.user?.name?.toLowerCase().includes(q));
  }, [friends, searchQuery]);

  const discoverList = useMemo(() => {
    let source = allDiscover;
    if (discoverFilter === "neighbors") source = neighbors;
    if (discoverFilter === "mutuals") source = mutuals;
    if (discoverFilter === "sellers") source = sellers;

    if (!searchQuery.trim()) return source;
    const q = searchQuery.toLowerCase();
    return source.filter((u) => u.name?.toLowerCase().includes(q));
  }, [allDiscover, neighbors, mutuals, sellers, discoverFilter, searchQuery]);

  return (
    <div className="min-h-screen bg-background pb-20 text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-30 px-4 py-4 sm:px-6">
        <div className="max-w-4xl mx-auto space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary font-bold">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight">Community</h1>
                <p className="text-xs text-muted-foreground">Connect with neighbors and local buyers & sellers</p>
              </div>
            </div>
            <LocationChip />
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search friends or community members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-secondary/50 border border-border/60 rounded-full pl-9 pr-4 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition"
            />
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-border/40 gap-6 pt-2">
            <button
              onClick={() => setActiveTab("friends")}
              className={`pb-2.5 text-sm font-bold transition-all relative ${
                activeTab === "friends" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Friends ({friends.length})
              {requests.length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-red-500 text-white rounded-full font-bold">
                  {requests.length}
                </span>
              )}
              {activeTab === "friends" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              )}
            </button>

            <button
              onClick={() => setActiveTab("discover")}
              className={`pb-2.5 text-sm font-bold transition-all relative ${
                activeTab === "discover" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Discover
              {activeTab === "discover" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        ) : activeTab === "friends" ? (
          /* ── FRIENDS TAB ── */
          <div className="space-y-6">
            {/* Pending Friend Requests Section */}
            {filteredRequests.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-primary" />
                  Friend Requests ({filteredRequests.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredRequests.map((req) => (
                    <div
                      key={req.id}
                      className="p-3.5 rounded-2xl bg-card border border-border/60 flex items-center justify-between gap-3 hover:border-primary/40 transition"
                    >
                      <div
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => router.push(`/profile/${req.from_user?.id}`)}
                      >
                        <Avatar className="w-11 h-11 border border-border">
                          <AvatarImage src={req.from_user?.avatar_url} />
                          <AvatarFallback>{req.from_user?.name?.[0] || "U"}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-bold text-foreground leading-tight hover:underline">
                            {req.from_user?.name}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 text-primary" />
                            {req.from_user?.location?.lga || req.from_user?.location?.state || "Neighbor"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRequestAction(req.id, "accepted")}
                          disabled={actionInProgress[req.id]}
                          className="p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition text-xs font-bold"
                        >
                          <UserCheck className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRequestAction(req.id, "declined")}
                          disabled={actionInProgress[req.id]}
                          className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition text-xs font-bold"
                        >
                          <UserX className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* My Friends List */}
            <div className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                My Friends ({filteredFriends.length})
              </h2>

              {filteredFriends.length === 0 ? (
                <div className="p-8 text-center bg-card/40 rounded-2xl border border-dashed border-border/80 space-y-3">
                  <User className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
                  <div>
                    <p className="text-sm font-bold text-foreground">No friends yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Switch to the <span className="font-semibold text-primary">Discover</span> tab to connect with neighbors around you.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredFriends.map((f) => (
                    <div
                      key={f.reqId}
                      className="p-3.5 rounded-2xl bg-card border border-border/60 flex items-center justify-between gap-3 hover:border-primary/40 transition"
                    >
                      <div
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => router.push(`/profile/${f.user?.id}`)}
                      >
                        <Avatar className="w-11 h-11 border border-border">
                          <AvatarImage src={f.user?.avatar_url} />
                          <AvatarFallback>{f.user?.name?.[0] || "F"}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-bold text-foreground leading-tight hover:underline">
                            {f.user?.name}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 text-primary" />
                            {f.user?.location?.lga || f.user?.location?.state || "Neighbor"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleStartChat(f.user?.id)}
                          className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 hover:bg-primary/90 transition"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Chat
                        </button>
                        <button
                          onClick={() => handleRemoveFriend(f.reqId, f.user?.id, f.user?.name)}
                          disabled={actionInProgress[f.reqId]}
                          className="p-1.5 rounded-xl bg-secondary text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition"
                          title="Remove Friend"
                        >
                          <UserX className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── DISCOVER TAB ── */
          <div className="space-y-5">
            {/* Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "neighbors", label: "Neighbors" },
                  { id: "mutuals", label: "Mutuals" },
                  { id: "sellers", label: "Sellers" },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setDiscoverFilter(pill.id)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all border ${
                    discoverFilter === pill.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border/60 hover:text-foreground"
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Discover Grid */}
            {discoverList.length === 0 ? (
              <div className="p-8 text-center bg-card/40 rounded-2xl border border-dashed border-border/80 space-y-2">
                <Users className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
                <p className="text-sm font-bold text-foreground">No people found in this filter</p>
                <p className="text-xs text-muted-foreground">Try selecting a different category filter or expanding your location.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {discoverList.map((u) => (
                  <div
                    key={u.id}
                    className="p-3.5 rounded-2xl bg-card border border-border/60 flex items-center justify-between gap-3 hover:border-primary/40 transition"
                  >
                    <div
                      className="flex items-center gap-3 cursor-pointer"
                      onClick={() => router.push(`/profile/${u.id}`)}
                    >
                      <Avatar className="w-11 h-11 border border-border">
                        <AvatarImage src={u.avatar_url} />
                        <AvatarFallback>{u.name?.[0] || "U"}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-foreground leading-tight hover:underline">
                            {u.name}
                          </p>
                          {u.verified_seller && (
                            <ShieldCheck className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500/20" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-primary" />
                          {u.location?.lga || u.location?.state || "Neighbor"}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleSendRequest(u.id)}
                      disabled={actionInProgress[u.id]}
                      className="px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 hover:bg-primary/90 transition disabled:opacity-50"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}