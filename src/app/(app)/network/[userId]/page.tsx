"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search, UserCheck, UserPlus, UserMinus, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-jersey25)";

export default function NetworkPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();

  const targetUserId = params?.userId as string;
  const initialMode = (searchParams?.get("mode") as "followers" | "following") || "followers";

  const [activeTab, setActiveTab] = useState<"followers" | "following">(initialMode);
  const [searchQuery, setSearchQuery] = useState("");
  const [followers, setFollowers] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [myFollowingIds, setMyFollowingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const isOwnProfile = currentUser?.id === targetUserId;

  const loadNetworkData = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);

    try {
      // 1. Fetch Followers
      const { data: followerRows } = await supabase
        .from("followers")
        .select("follower_id")
        .eq("following_id", targetUserId);

      const followerIds = (followerRows || []).map((r: any) => r.follower_id).filter(Boolean);

      let fetchedFollowers: any[] = [];
      if (followerIds.length > 0) {
        const { data: followerUsers } = await supabase
          .from("users")
          .select("id, name, username, avatar_url, verified, verified_seller")
          .in("id", followerIds);
        fetchedFollowers = followerUsers || [];
      }

      // 2. Fetch Following
      const { data: followingRows } = await supabase
        .from("followers")
        .select("following_id")
        .eq("follower_id", targetUserId);

      const followingIds = (followingRows || []).map((r: any) => r.following_id).filter(Boolean);

      let fetchedFollowing: any[] = [];
      if (followingIds.length > 0) {
        const { data: followingUsers } = await supabase
          .from("users")
          .select("id, name, username, avatar_url, verified, verified_seller")
          .in("id", followingIds);
        fetchedFollowing = followingUsers || [];
      }

      // 3. Fetch current user's following list (to determine follow state on cards)
      if (currentUser?.id) {
        const { data: myFollowingData } = await supabase
          .from("followers")
          .select("following_id")
          .eq("follower_id", currentUser.id);

        if (myFollowingData) {
          setMyFollowingIds(new Set(myFollowingData.map((r) => r.following_id)));
        }
      }

      setFollowers(fetchedFollowers);
      setFollowing(fetchedFollowing);
    } catch (err) {
      console.error("Failed loading network:", err);
    } finally {
      setLoading(false);
    }
  }, [targetUserId, currentUser?.id]);

  useEffect(() => {
    loadNetworkData();
  }, [loadNetworkData]);

  const handleToggleFollow = async (userId: string) => {
    if (!currentUser) return;
    const isCurrentlyFollowing = myFollowingIds.has(userId);

    try {
      if (isCurrentlyFollowing) {
        await supabase
          .from("followers")
          .delete()
          .eq("follower_id", currentUser.id)
          .eq("following_id", userId);

        setMyFollowingIds((prev) => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
        toast({ title: "Unfollowed user" });
      } else {
        await supabase
          .from("followers")
          .insert({ follower_id: currentUser.id, following_id: userId });

        setMyFollowingIds((prev) => new Set(prev).add(userId));
        toast({ title: "Now following user" });
      }
    } catch (err) {
      console.error("Follow action failed:", err);
      toast({ title: "Action failed", variant: "destructive" });
    }
  };

  const handleRemoveFollower = async (followerId: string) => {
    if (!currentUser || !isOwnProfile) return;

    try {
      await supabase
        .from("followers")
        .delete()
        .eq("follower_id", followerId)
        .eq("following_id", currentUser.id);

      setFollowers((prev) => prev.filter((u) => u.id !== followerId));
      toast({ title: "Follower removed" });
    } catch (err) {
      console.error("Remove follower failed:", err);
    }
  };

  const listToDisplay = activeTab === "followers" ? followers : following;
  const filteredList = listToDisplay.filter(
    (user) =>
      user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-card transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
          Network
        </h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Tabs */}
        <div className="flex bg-card p-1 rounded-xl border border-border/40">
          <button
            onClick={() => setActiveTab("followers")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "followers"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            Followers ({followers.length})
          </button>
          <button
            onClick={() => setActiveTab("following")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "following"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            Following ({following.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or @username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card border border-border/40 text-sm text-foreground focus:outline-none focus:border-primary"
            style={{ fontFamily: FONT }}
          />
        </div>

        {/* List */}
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-7 h-7 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredList.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground space-y-1" style={{ fontFamily: FONT }}>
            <p className="font-semibold text-sm">No {activeTab} found</p>
            {searchQuery && <p className="text-xs">Try a different search query.</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredList.map((user) => {
              const isFollowingUser = myFollowingIds.has(user.id);
              const isSelf = currentUser?.id === user.id;

              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-card border border-border/40 hover:border-primary/30 transition-all"
                >
                  <div
                    onClick={() => router.push(`/profile/${user.id}`)}
                    className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
                  >
                    <Avatar className="w-11 h-11 border border-border/40">
                      <AvatarImage src={user.avatar_url} />
                      <AvatarFallback className="bg-primary text-white font-bold">
                        {user.name?.charAt(0) || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-foreground text-sm truncate" style={{ fontFamily: RALEWAY }}>
                          {user.name}
                        </span>
                        {(user.verified || user.verified_seller) && (
                          <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                        )}
                      </div>
                      {user.username && (
                        <p className="text-xs text-muted-foreground truncate" style={{ fontFamily: FONT }}>
                          @{user.username}
                        </p>
                      )}
                    </div>
                  </div>

                  {!isSelf && (
                    <div className="flex items-center gap-2 shrink-0">
                      {activeTab === "followers" && isOwnProfile && (
                        <button
                          onClick={() => handleRemoveFollower(user.id)}
                          className="px-3 py-1.5 rounded-full border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/10 transition-colors"
                          style={{ fontFamily: FONT }}
                        >
                          Remove
                        </button>
                      )}

                      <button
                        onClick={() => handleToggleFollow(user.id)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                          isFollowingUser
                            ? "border border-border/60 text-muted-foreground hover:bg-card"
                            : "bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                        }`}
                        style={{ fontFamily: FONT }}
                      >
                        {isFollowingUser ? "Following" : "Follow"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
