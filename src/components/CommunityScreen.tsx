"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Zap, FileText, Search, Plus } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Post } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { PostCard } from "@/components/PostCard";
import { CreatePostDialog } from "@/components/CreatePostDialog";
import { usePosts } from "@/hooks/use-posts";
import { useFriendshipGlobal } from "@/hooks/use-friendship-global";
import { useLocation } from "@/contexts/LocationContext";
import { LocationChip } from "@/components/LocationChip";

const GREEN = "#388E3C";
const CARD = "var(--c-card)";
const FONT = "Inter, sans-serif";
const PACIFICO = "Pacifico, cursive";

interface CommunityScreenProps {
  className?: string;
}

// Sub-component for rendering user action buttons with global friendship state
function UserActionButton({
  userId,
  onFriendAction,
}: {
  userId: string;
  onFriendAction: (userId: string, action: "add" | "remove" | "accept" | "decline", actionFn: () => Promise<void>) => Promise<void>;
}) {
  const friendshipHook = useFriendshipGlobal(userId);
  const status = friendshipHook.status;
  const isLoading = friendshipHook.isLoading;

  switch (status) {
    case "none":
      return (
        <button
          onClick={() => onFriendAction(userId, "add", () => friendshipHook.addFriend())}
          className="rounded-full px-3 py-1 text-[0.6875rem] text-foreground font-bold uppercase disabled:opacity-50"
          style={{ background: GREEN, fontFamily: FONT }}
          disabled={isLoading}
        >
          {isLoading ? "..." : "Add"}
        </button>
      );
    case "request_sent":
      return (
        <button
          className="rounded-full px-3 py-1 text-[0.6875rem] text-[#BBBBBB] font-bold uppercase"
          style={{ border: "0.5px solid #388E3C", fontFamily: FONT }}
          disabled
        >
          Sent
        </button>
      );
    case "friends":
      return (
        <button
          onClick={() => onFriendAction(userId, "remove", () => friendshipHook.removeFriend())}
          className="rounded-full px-3 py-1 text-[0.6875rem] font-bold uppercase disabled:opacity-50"
          style={{ border: "0.5px solid rgba(229,57,53,0.4)", color: "#E53935", fontFamily: FONT }}
          disabled={isLoading}
        >
          {isLoading ? "..." : "Remove"}
        </button>
      );
    case "request_received":
      return (
        <>
          <button
            onClick={() => onFriendAction(userId, "accept", () => friendshipHook.acceptRequest())}
            className="rounded-full px-3 py-1 text-[0.6875rem] text-foreground font-bold uppercase disabled:opacity-50"
            style={{ background: GREEN, fontFamily: FONT }}
            disabled={isLoading}
          >
            {isLoading ? "..." : "Accept"}
          </button>
          <button
            onClick={() => onFriendAction(userId, "decline", () => friendshipHook.declineRequest())}
            className="rounded-full px-3 py-1 text-[0.6875rem] font-bold uppercase disabled:opacity-50"
            style={{ border: "0.5px solid rgba(229,57,53,0.4)", color: "#E53935", fontFamily: FONT }}
            disabled={isLoading}
          >
            {isLoading ? "..." : "Decline"}
          </button>
        </>
      );
  }
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function StatCard({
  icon: Icon,
  value,
  label,
  onClick,
}: {
  icon: React.ElementType;
  value: string | number;
  label: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex flex-col items-center text-center p-4 space-y-2 ${
        onClick ? "cursor-pointer transition-all hover:opacity-80" : ""
      }`}
      style={{ background: 'var(--c-card)', borderRadius: 11 }}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{ background: "rgba(56,142,60,0.2)" }}
      >
        <Icon className="w-5 h-5" style={{ color: GREEN }} />
      </div>
      <div>
        <div className="text-xl font-bold text-foreground" style={{ fontFamily: "Inter, sans-serif" }}>
          {value}
        </div>
        <div
          className="text-[0.625rem] uppercase tracking-wider"
          style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

export function CommunityScreen({ className }: CommunityScreenProps) {
  const { user: currentUser, profile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { filterState, filterLga } = useLocation();
  const { posts, loading: postsLoading, createPost, deletePost } = usePosts({ filterState, filterLga });
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [pendingFriendRequests, setPendingFriendRequests] = useState<any[]>([]);
  const [friendRequestsLoading, setFriendRequestsLoading] = useState(true);
  const [stats, setStats] = useState({ totalUsers: 0, activeToday: 0, newPosts24h: 0 });
  const searchRef = useRef<HTMLDivElement>(null);

  /* ── Stats ── */
  useEffect(() => {
    if (!currentUser) return;
    const fetchStats = async () => {
      // Count users in the same location
      let usersQuery = supabase
        .from("users")
        .select("*", { count: "exact", head: true });
      // Filter neighbors by location
      if (filterState) {
        usersQuery = usersQuery.contains('location', { state: filterState });
      }
      if (filterLga) {
        usersQuery = usersQuery.contains('location', { lga: filterLga });
      }
      const { count: totalUsers } = await usersQuery;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const { data: activePosters } = await supabase
        .from("posts")
        .select("user_id")
        .gte("timestamp", yesterday.toISOString());
      const { data: activeCommenters } = await supabase
        .from("comments")
        .select("user_id")
        .gte("timestamp", yesterday.toISOString());
      const activeUserIds = new Set([
        ...(activePosters?.map((p) => p.user_id) || []),
        ...(activeCommenters?.map((c) => c.user_id) || []),
      ]);
      let postsQuery = supabase
        .from("posts")
        .select("*", { count: "exact", head: true })
        .gte("timestamp", yesterday.toISOString());
      if (filterState) {
        postsQuery = postsQuery.eq('state', filterState);
      }
      if (filterLga) {
        postsQuery = postsQuery.eq('lga', filterLga);
      }
      const { count: newPosts24h } = await postsQuery;
      setStats({
        totalUsers: totalUsers || 0,
        activeToday: activeUserIds.size,
        newPosts24h: newPosts24h || 0,
      });
    };
    fetchStats();
  }, [currentUser, filterState, filterLga]);

  /* ── Pending Friend Requests ── */
  useEffect(() => {
    if (!currentUser) return;
    const fetch = async () => {
      setFriendRequestsLoading(true);
      const { data } = await supabase
        .from("friend_requests")
        .select(
          `id, from_user_id, created_at,
           users!friend_requests_from_user_id_fkey(id, name, avatar_url, bio, location)`
        )
        .eq("to_user_id", currentUser.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      setPendingFriendRequests(data || []);
      setFriendRequestsLoading(false);
    };
    fetch();
  }, [currentUser]);

  /* ── Click outside search ── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowUserSearch(false);
        setUsers([]);
      }
    };
    if (showUserSearch) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showUserSearch]);

  const searchUsers = async (query: string) => {
    if (!query.trim()) { setUsers([]); setShowUserSearch(false); return; }
    setUserSearchLoading(true);
    try {
      const { data } = await supabase
        .from("users")
        .select("id, name, avatar_url, created_at")
        .ilike("name", `%${query}%`)
        .neq("id", currentUser?.id)
        .limit(10);
      const usersData = data || [];
      setUsers(usersData);
      setShowUserSearch(true);
    } catch { /* ignore */ } finally {
      setUserSearchLoading(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim()) searchUsers(value);
    else { setShowUserSearch(false); setUsers([]); }
  };

  const handleFriendAction = async (
    userId: string,
    action: "add" | "remove" | "accept" | "decline",
    actionFn: () => Promise<void>
  ) => {
    if (!currentUser) return;
    try {
      await actionFn();
      
      // Update pending requests list if needed
      if (action === "accept" || action === "decline") {
        setPendingFriendRequests((p) => p.filter((r) => r.from_user_id !== userId));
      }
    } catch (error) {
      console.error("Error handling friend action:", error);
      toast({ variant: "destructive", title: "Error", description: "Action failed." });
    }
  };

  const getLocation = (loc: unknown): string => {
    if (!loc || typeof loc !== "object") return "";
    const o = loc as Record<string, unknown>;
    if (typeof o.lga === "string" && typeof o.state === "string")
      return `${o.lga}, ${o.state}`;
    if (typeof o.state === "string") return o.state;
    return "";
  };

  const filteredPosts = useMemo(() => {
    if (!searchQuery || showUserSearch) return posts;
    const q = searchQuery.toLowerCase();
    return posts.filter(
      (p) =>
        p.text?.toLowerCase().includes(q) ||
        p.title?.toLowerCase().includes(q) ||
        p.author_name?.toLowerCase().includes(q)
    );
  }, [posts, searchQuery, showUserSearch]);

  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: "var(--c-bg)" }}>
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-8">

        {/* ── Header ── */}
        <header className="space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="text-[1.25rem] text-foreground" style={{ fontFamily: PACIFICO }}>
              Community
            </h1>
            <LocationChip />
          </div>
          <p className="text-[0.75rem]" style={{ fontFamily: FONT, fontStyle: "italic", fontWeight: 300, color: "var(--c-text-muted)" }}>
            Connecting neighbors, one story at a time.
          </p>
        </header>

        {/* ── Search ── */}
        <div className="relative" ref={searchRef}>
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--c-text-muted)" }} />
          <input
            type="text"
            placeholder="Search for neighbors or posts..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full rounded-full px-6 pl-11 py-4 text-sm text-foreground outline-none focus:ring-1 focus:ring-[#388E3C]/50"
            style={{
              background: "var(--c-card2)",
              border: "0.5px solid #388E3C",
              fontFamily: FONT,
            }}
          />

          {/* User search results dropdown */}
          {showUserSearch && users.length > 0 && (
            <div
              className="absolute top-full mt-2 w-full z-20 overflow-hidden"
              style={{ background: 'var(--c-card)', borderRadius: 11, border: "0.5px solid rgba(255,255,255,0.08)" }}
            >
              {userSearchLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded-full" style={{ background: "var(--c-card2)" }} />
                      <Skeleton className="h-4 w-32" style={{ background: "var(--c-card2)" }} />
                    </div>
                  ))}
                </div>
              ) : (
                users.map((u) => (
                  <div
                    key={u.id}
                    onClick={() => router.push(`/profile/${u.id}`)}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
                    style={{ borderBottom: "0.5px solid rgba(255,255,255,0.05)" }}
                  >
                    <Avatar className="w-10 h-10 flex-shrink-0">
                      <AvatarImage src={u.avatar_url} />
                      <AvatarFallback style={{ background: GREEN, color: "#fff", fontFamily: FONT, fontWeight: 700 }}>
                        {u.name?.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground text-[0.8125rem] truncate" style={{ fontFamily: FONT, fontWeight: 600 }}>
                        {u.name}
                      </p>
                    </div>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <UserActionButton userId={u.id} onFriendAction={handleFriendAction} />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

  {/* ── Stats Row ── */}
  <div className="grid grid-cols-3 gap-3">
    <StatCard 
      icon={Users} 
      value={fmt(stats.totalUsers)} 
      label="Neighbors"
    />
    <StatCard icon={Zap} value={fmt(stats.activeToday)} label="Active Today" />
    <StatCard icon={FileText} value={fmt(stats.newPosts24h)} label="New Posts" />
  </div>

        {/* ── Friend Requests ── */}
        {(pendingFriendRequests.length > 0 || friendRequestsLoading) && (
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-foreground font-semibold text-lg" style={{ fontFamily: "Inter, sans-serif" }}>
                Friend Requests
              </h2>
              <button
                className="text-[0.6875rem] font-bold uppercase tracking-widest"
                style={{ color: GREEN, fontFamily: FONT }}
                onClick={() => router.push('/notifications')}
              >
                View All
              </button>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
              {friendRequestsLoading
                ? [1, 2].map((i) => (
                    <div
                      key={i}
                      className="min-w-[180px] flex flex-col items-center p-4 space-y-3"
                      style={{ background: "var(--c-card)", borderRadius: 11 }}
                    >
                      <Skeleton className="w-16 h-16 rounded-full" style={{ background: "var(--c-card2)" }} />
                      <Skeleton className="h-4 w-24" style={{ background: "var(--c-card2)" }} />
                      <Skeleton className="h-8 w-full rounded-full" style={{ background: "var(--c-card2)" }} />
                    </div>
                  ))
                : pendingFriendRequests.map((req) => {
                    const sender = req.users;
                    if (!sender) return null;
                    const loc = getLocation(sender.location);
                    return (
                      <div
                        key={req.id}
                        className="min-w-[180px] flex flex-col items-center p-4 space-y-3 flex-shrink-0"
                        style={{ background: "var(--c-card)", borderRadius: 11 }}
                      >
                        <Avatar
                          className="w-16 h-16 cursor-pointer"
                          onClick={() => router.push(`/profile/${sender.id}`)}
                        >
                          <AvatarImage src={sender.avatar_url} />
                          <AvatarFallback
                            style={{ background: GREEN, color: "#fff", fontFamily: FONT, fontWeight: 700, fontSize: 22 }}
                          >
                            {sender.name?.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="text-center">
                          <p className="text-foreground text-sm font-semibold" style={{ fontFamily: "Inter, sans-serif" }}>
                            {sender.name}
                          </p>
                          {loc && (
                            <p className="text-[0.625rem]" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
                              {loc}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 w-full">
                          <UserActionButton userId={sender.id} onFriendAction={handleFriendAction} />
                        </div>
                      </div>
                    );
                  })}
            </div>
          </section>
        )}

        {/* ── Recent Updates Feed ── */}
        <section className="space-y-4">
          <h2 className="text-foreground font-semibold text-lg" style={{ fontFamily: "Inter, sans-serif" }}>
            Recent Updates
          </h2>

          {postsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-40 w-full rounded-[11px]" style={{ background: CARD }} />
              ))}
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                style={{ background: CARD }}
              >
                <FileText className="w-8 h-8" style={{ color: GREEN, opacity: 0.5 }} />
              </div>
              <h3 className="text-foreground text-lg mb-2" style={{ fontFamily: PACIFICO }}>
                No posts yet
              </h3>
              <p className="text-[0.8125rem]" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
                Be the first to share something with your neighbors!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPosts.map((post) => (
                <PostCard key={post.id} post={post} onDelete={deletePost} onCreatePost={createPost} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── FAB ── */}
      <CreatePostDialog createPost={createPost}>
        <button
          className="fixed bottom-20 right-4 w-14 h-14 rounded-full flex items-center justify-center z-40 transition-transform active:scale-90"
          style={{
            background: GREEN,
            boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
          }}
        >
          <Plus className="w-7 h-7 text-foreground" />
        </button>
      </CreatePostDialog>
    </div>
  );
}
