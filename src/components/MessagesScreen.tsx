"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, MessageSquare, Plus, Trash2, X, ShoppingBag } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ConversationScreen } from "@/components/ConversationScreen";

import { VerifiedBadge } from "@/components/VerifiedBadge";

const GREEN = "#82DB7E";

type ConvType = "friend" | "marketplace" | "briefcase";
type FilterTab = "all" | "friends" | "marketplace" | "business";

interface Conversation {
  id: string;
  type: ConvType;
  participantId: string;
  participantName: string;
  participantAvatar: string | null;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
  isVerified?: boolean;
  isSeller?: boolean;
  context?: {
    itemId?: string;
    itemTitle?: string;
    itemImage?: string;
    itemPrice?: number;
  };
  deleted_by?: string[];
}

function timeLabel(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 24) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

function ConversationItem({
  item,
  isActive,
  onSelect,
  onDelete,
}: {
  item: Conversation;
  isActive?: boolean;
  onSelect: (id: string, e?: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}) {
  const isUnread = item.unreadCount > 0;

  return (
    <div
      onClick={(e) => onSelect(item.id, e)}
      className={cn(
        "group flex items-center gap-3.5 px-4 py-3 cursor-pointer transition-all hover:bg-white/5 border-l-4 border-transparent relative",
        isUnread && "bg-[#82DB7E]/[0.03]",
        isActive && "bg-[#82DB7E]/10 border-l-[#82DB7E]"
      )}
    >
      {/* Avatar */}
      <div className="relative w-12 h-12 flex-shrink-0">
        {item.participantAvatar ? (
          <Image
            src={item.participantAvatar}
            alt={item.participantName}
            width={48}
            height={48}
            className="w-12 h-12 rounded-full object-cover"
            unoptimized
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[#82DB7E]/10 flex items-center justify-center font-bold text-lg text-[#82DB7E] font-yrdly-display">
            {item.participantName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#82DB7E] border-2 border-[var(--yrdly-dark)]" />
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                "text-sm font-semibold truncate text-foreground font-yrdly-display",
                isUnread && "font-extrabold"
              )}
            >
              {item.participantName}
            </span>
            {item.isVerified && (
              <VerifiedBadge size={15} type={item.isSeller ? "seller" : "user"} />
            )}
          </div>
          <span
            className={cn(
              "text-xs font-mono flex-shrink-0",
              isUnread ? "text-[#82DB7E] font-bold" : "text-[var(--yrdly-label)]"
            )}
          >
            {timeLabel(item.timestamp)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p
            className={cn(
              "text-xs truncate font-yrdly-body",
              isUnread ? "text-foreground font-medium" : "text-[var(--yrdly-label)]"
            )}
          >
            {item.lastMessage}
          </p>
          {isUnread && (
            <span
              className="px-1.5 py-0.2 min-w-[18px] h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-black flex-shrink-0"
              style={{ backgroundColor: GREEN }}
            >
              {item.unreadCount}
            </span>
          )}
        </div>

        {item.context?.itemTitle && (
          <div className="flex items-center gap-1 mt-1 text-[11px] text-[var(--yrdly-label)]">
            <ShoppingBag size={11} />
            <span className="truncate">{item.context.itemTitle}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface MessagesScreenProps {
  initialConvId?: string;
}

export function MessagesScreen({ initialConvId }: MessagesScreenProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [selectedConvId, setSelectedConvId] = useState<string | null>(initialConvId || null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  const [friends, setFriends] = useState<{ id: string; name: string; avatar_url: string }[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);

  const FILTERS: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "friends", label: "Friends" },
    { key: "marketplace", label: "Marketplace" },
    { key: "business", label: "Business" },
  ];

  useEffect(() => {
    if (initialConvId) {
      setSelectedConvId(initialConvId);
    }
  }, [initialConvId]);

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .contains("participant_ids", [user.id])
        .order("updated_at", { ascending: false });

      if (error || !data) return;

      const { data: unreadData } = await supabase
        .from("messages")
        .select("conversation_id")
        .eq("is_read", false)
        .neq("sender_id", user.id)
        .in(
          "conversation_id",
          data.map((c: any) => c.id)
        );

      const unreadCounts = (unreadData || []).reduce((acc: Record<string, number>, curr: any) => {
        acc[curr.conversation_id] = (acc[curr.conversation_id] || 0) + 1;
        return acc;
      }, {});

      const otherUserIds = Array.from(
        new Set(
          data
            .map((c: any) => c.participant_ids?.find((id: string) => id !== user.id))
            .filter(Boolean)
        )
      ) as string[];

      let usersMap = new Map();
      if (otherUserIds.length > 0) {
        const { data: usersData } = await supabase
          .from("users")
          .select("id, name, username, avatar_url, verified_seller, phone_verified")
          .in("id", otherUserIds);

        if (usersData) {
          usersMap = new Map(usersData.map((u: any) => [u.id, u]));
        }
      }

      const formatted: Conversation[] = data
        .filter((c: any) => !c.deleted_by?.includes(user.id) || (unreadCounts[c.id] || 0) > 0)
        .map((c: any) => {
          const otherId = c.participant_ids?.find((id: string) => id !== user.id);
          const otherUser = usersMap.get(otherId);

          let convType: ConvType = "friend";
          if (c.type === "marketplace" || (c.item_id && c.type !== "briefcase" && c.type !== "business"))
            convType = "marketplace";
          else if (c.type === "briefcase" || c.type === "business" || c.business_id) convType = "briefcase";

          const isBiz = convType === "briefcase" || !!c.business_id;
          const participantName = isBiz
            ? c.business_name || c.item_title || otherUser?.name || "Business"
            : otherUser?.name || c.item_title || "Neighbour";
          const participantAvatar =
            isBiz && (c.business_image || c.item_image)
              ? c.business_image || c.item_image
              : otherUser?.avatar_url && !otherUser.avatar_url.startsWith("file://")
              ? otherUser.avatar_url
              : null;

          const isVerified = isBiz || !!otherUser?.verified_seller || !!otherUser?.is_verified || !!otherUser?.phone_verified;
          const isSeller = isBiz || !!otherUser?.verified_seller;

          return {
            id: c.id,
            type: convType,
            participantId: otherId || "",
            participantName,
            participantAvatar,
            lastMessage: c.last_message_text || c.last_message || "Tap to chat",
            timestamp: c.updated_at || c.created_at,
            unreadCount: unreadCounts[c.id] || 0,
            isVerified,
            isSeller,
            context:
              c.item_title || c.item_id || c.business_name
                ? {
                    itemId: c.item_id,
                    itemTitle: c.item_title || c.business_name,
                    itemImage: c.item_image || c.business_image,
                    itemPrice: c.item_price,
                  }
                : undefined,
          };
        });

      setConversations(formatted);
    } catch (e) {
      console.error("Fetch conversations error:", e);
    } finally {
      setLoading(false);
    }
  }, [user, initialConvId]);

  useEffect(() => {
    fetchConversations();

    if (!user) return;
    const channel = supabase
      .channel("conversations_realtime_web")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () =>
        fetchConversations()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () =>
        fetchConversations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchConversations]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (activeFilter === "friends" && c.type !== "friend") return false;
      if (activeFilter === "marketplace" && c.type !== "marketplace") return false;
      if (activeFilter === "business" && c.type !== "briefcase") return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return c.participantName.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q);
      }
      return true;
    });
  }, [conversations, activeFilter, searchQuery]);

  const totalUnread = useMemo(() => {
    return conversations.reduce((sum, c) => sum + c.unreadCount, 0);
  }, [conversations]);

  const handleSelectConv = (id: string, e?: React.MouseEvent) => {
    setSelectedConvId(id);
    router.push(`/messages/${id}`);
  };

  const handleDeleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;
    if (!confirm("Are you sure you want to delete this conversation? This action cannot be undone.")) return;

    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("deleted_by")
        .eq("id", conversationId)
        .single();

      if (error) throw error;

      const currentDeletedBy = data.deleted_by || [];
      if (!currentDeletedBy.includes(user.id)) {
        const newDeletedBy = [...currentDeletedBy, user.id];
        const { error: updateError } = await supabase
          .from("conversations")
          .update({ deleted_by: newDeletedBy })
          .eq("id", conversationId);

        if (updateError) throw updateError;

        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        if (selectedConvId === conversationId) {
          setSelectedConvId(null);
          if (typeof window !== "undefined") {
            window.history.pushState(null, "", "/messages");
          }
        }
        toast({ title: "Conversation deleted" });
      }
    } catch (e) {
      console.error("Failed to delete conversation", e);
      toast({ title: "Failed to delete conversation", variant: "destructive" });
    }
  };

  // Load connections for New Message dialog
  useEffect(() => {
    if (!user || !isNewMessageOpen) return;
    const loadFriends = async () => {
      setFriendsLoading(true);
      try {
        const { data: userData } = await supabase.from("users").select("friends").eq("id", user.id).single();
        const friendIds = userData?.friends || [];
        if (friendIds.length > 0) {
          const { data: friendsData } = await supabase
            .from("users")
            .select("id, name, avatar_url")
            .in("id", friendIds);
          setFriends(friendsData || []);
        } else {
          setFriends([]);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setFriendsLoading(false);
      }
    };
    loadFriends();
  }, [user, isNewMessageOpen]);

  const handleStartChat = async (friendId: string) => {
    if (!user) return;
    try {
      const sortedIds = [user.id, friendId].sort();
      const { data: existingConvs } = await supabase
        .from("conversations")
        .select("id, type")
        .contains("participant_ids", sortedIds);

      const existing = existingConvs?.find((c) => c.type === "friend");
      let cid: string;

      if (!existing) {
        const { data: newConv, error } = await supabase
          .from("conversations")
          .insert({
            participant_ids: sortedIds,
            type: "friend",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (error) throw error;
        cid = newConv.id;
      } else {
        cid = existing.id;
      }

      setIsNewMessageOpen(false);
      handleSelectConv(cid);
    } catch (err) {
      toast({ title: "Failed to start chat", variant: "destructive" });
    }
  };

  return (
    <div className="w-full h-full bg-[var(--yrdly-dark)] overflow-hidden flex flex-col md:flex-row font-yrdly-body">
      {/* ── Left Sidebar (Conversations List) ── */}
      <div
        className={cn(
          "w-full md:w-80 lg:w-96 flex flex-col h-full shrink-0 border-r border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)]",
          selectedConvId ? "hidden md:flex" : "flex"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          {searching ? (
            <div className="flex items-center gap-3 w-full">
              <div className="flex-1 flex items-center gap-2 bg-surface border border-[var(--yrdly-glass-border)] rounded-full px-3.5 py-2">
                <Search className="w-4 h-4 text-[var(--yrdly-label)]" />
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search messages..."
                  className="w-full bg-transparent outline-none text-sm text-foreground placeholder:text-[var(--yrdly-label)] font-yrdly-body"
                />
                {searchQuery.length > 0 && (
                  <button type="button" onClick={() => setSearchQuery("")}>
                    <X className="w-4 h-4 text-[var(--yrdly-label)]" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearching(false);
                  setSearchQuery("");
                }}
                className="text-sm font-semibold text-[#82DB7E] hover:opacity-80"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-extrabold text-foreground font-yrdly-display">Messages</h1>
                {totalUnread > 0 && (
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-bold text-black"
                    style={{ backgroundColor: GREEN }}
                  >
                    {totalUnread}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSearching(true)}
                  className="w-9 h-9 rounded-full bg-surface border border-[var(--yrdly-glass-border)] flex items-center justify-center text-foreground hover:bg-white/5 transition-all"
                >
                  <Search className="w-4 h-4" />
                </button>

                <Dialog open={isNewMessageOpen} onOpenChange={setIsNewMessageOpen}>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="w-9 h-9 rounded-full flex items-center justify-center text-black font-bold transition-all hover:opacity-90"
                      style={{ backgroundColor: GREEN }}
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </DialogTrigger>
                  <DialogContent className="bg-[var(--yrdly-dark)] border border-[var(--yrdly-glass-border)] text-foreground font-yrdly-body max-w-sm rounded-2xl">
                    <DialogHeader>
                      <DialogTitle className="font-yrdly-display font-bold text-lg">New Message</DialogTitle>
                    </DialogHeader>
                    <div className="py-2 max-h-[300px] overflow-y-auto space-y-1">
                      {friendsLoading ? (
                        <div className="flex justify-center py-6">
                          <Skeleton className="w-6 h-6 rounded-full" />
                        </div>
                      ) : friends.length === 0 ? (
                        <div className="p-6 text-center text-xs text-[var(--yrdly-label)]">
                          You have no connections to message yet.
                        </div>
                      ) : (
                        friends.map((friend) => (
                          <button
                            key={friend.id}
                            onClick={() => handleStartChat(friend.id)}
                            className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors text-left"
                          >
                            <Avatar className="w-10 h-10 border border-[var(--yrdly-glass-border)]">
                              <AvatarImage src={friend.avatar_url || "/placeholder.svg"} />
                              <AvatarFallback className="bg-primary text-black font-bold font-yrdly-display">
                                {friend.name?.charAt(0) || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 overflow-hidden">
                              <p className="font-bold text-sm truncate text-foreground font-yrdly-display">
                                {friend.name}
                              </p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          )}
        </div>

        {/* Filter Pills */}
        {!searching && (
          <div className="px-4 mb-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              {FILTERS.map((item) => {
                const active = activeFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveFilter(item.key)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border flex-shrink-0",
                      active
                        ? "bg-[#82DB7E]/10 border-[#82DB7E]/30 text-[#82DB7E] font-bold"
                        : "bg-transparent border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)] hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-surface">
          {loading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3.5 p-3 rounded-2xl border border-[var(--yrdly-glass-border)] bg-card">
                  <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-4">
              <div className="w-16 h-16 rounded-3xl bg-surface border border-[var(--yrdly-glass-border)] flex items-center justify-center">
                <MessageSquare className="w-8 h-8 text-[#82DB7E]" />
              </div>
              <div>
                <h3 className="text-base font-bold font-yrdly-display text-foreground mb-1">No messages yet</h3>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Say hello to someone in your neighbourhood.
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push("/explore")}
                className="px-5 py-2.5 rounded-full font-bold text-xs text-black transition-opacity hover:opacity-90"
                style={{ backgroundColor: GREEN }}
              >
                Start a Conversation
              </button>
            </div>
          ) : (
            filteredConversations.map((item) => (
              <ConversationItem
                key={item.id}
                item={item}
                isActive={selectedConvId === item.id}
                onSelect={handleSelectConv}
                onDelete={handleDeleteConversation}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right Main Pane (Active Chat Screen) ── */}
      <div
        className={cn(
          "flex-1 flex flex-col h-full min-h-0 bg-[var(--yrdly-dark)]/50",
          !selectedConvId ? "hidden md:flex" : "flex"
        )}
      >
        {selectedConvId ? (
          <ConversationScreen
            key={selectedConvId}
            conversationId={selectedConvId}
            onBack={() => {
              setSelectedConvId(null);
              router.push("/messages");
            }}
            isEmbedded
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-[var(--yrdly-dark)]">
            <div className="w-20 h-20 rounded-3xl bg-surface border border-[var(--yrdly-glass-border)] flex items-center justify-center mb-4 text-[#82DB7E]">
              <MessageSquare className="w-10 h-10" />
            </div>
            <h2 className="text-xl font-bold font-yrdly-display text-foreground mb-1">Your Messages</h2>
            <p className="text-sm text-[var(--yrdly-label)] max-w-sm font-yrdly-body">
              Select a conversation from the sidebar to chat with neighbours, sellers, or local businesses.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}