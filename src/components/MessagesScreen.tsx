"use client";

import { useState, useEffect, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, MessageCircle, Edit, Loader2, Trash2, ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import { ActivityIndicator } from "@/components/ActivityIndicator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";

const GREEN = "hsl(var(--primary))";
const CARD = "var(--c-card)";
const SURFACE = "var(--c-card)";
const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-raleway)";

interface Conversation {
  id: string;
  type: "friend" | "marketplace" | "business";
  participantId: string;
  participantName: string;
  participantAvatar: string;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
  isOnline: boolean;
  context?: {
    itemId?: string;
    itemTitle?: string;
    itemImage?: string;
    itemPrice?: number;
    businessId?: string;
    businessName?: string;
    businessLogo?: string;
    catalog_item_id?: string;
  };
}

type Tab = "all" | "friends" | "marketplace" | "business";

function deduplicateConversations(conversations: Conversation[]): Conversation[] {
  const seen = new Map<string, Conversation>();
  for (const conv of conversations) {
    let key: string;
    if (conv.type === "business") {
      const context = conv.context as any;
      const catalogItemId = context?.catalog_item_id;
      key = catalogItemId
        ? `business:${conv.participantId}:catalog:${catalogItemId}`
        : `business:${conv.participantId}`;
    } else if (conv.type === "marketplace") {
      const itemId = conv.context?.itemId || "general";
      key = `marketplace:${conv.participantId}:item:${itemId}`;
    } else {
      key = `friend:${conv.participantId}`;
    }
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, conv);
    } else if (new Date(conv.timestamp) > new Date(existing.timestamp)) {
      seen.set(key, conv);
    }
  }
  return Array.from(seen.values());
}

function timeLabel(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHrs = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return ts;
  }
}

export function MessagesScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  // Friends state for New Message dialog
  const [friends, setFriends] = useState<{ id: string; name: string; avatar_url: string }[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchConversations = async () => {
      try {
        const { data, error } = await supabase
          .from("conversations")
          .select(`*, messages(id, sender_id, is_read, read_by)`)
          .contains("participant_ids", [user.id])
          .order("updated_at", { ascending: false });

        if (error) { console.error(error); return; }

        const activeRows = (data || []).filter((conv: any) => !conv.deleted_by?.includes(user.id));

        const withCounts = await Promise.all(
          activeRows.map(async (conv) => {
            const readReceiptStr = conv.context?.read_receipts?.[user.id];
            const readReceiptDate = readReceiptStr ? new Date(readReceiptStr).getTime() : 0;
            const lastMsgDate = conv.last_message_timestamp ? new Date(conv.last_message_timestamp).getTime() : 0;
            const isReadByReceipt = readReceiptDate >= lastMsgDate && lastMsgDate > 0;

            if (conv.type === "marketplace") {
              const { data: chatMsgs } = await supabase
                .from("chat_messages")
                .select("sender_id, created_at, metadata")
                .eq("chat_id", conv.id)
                .order("created_at", { ascending: true });
              const last = chatMsgs?.[chatMsgs.length - 1];
              if (!last || last.sender_id === user.id || isReadByReceipt) return { ...conv, unread_count: 0 };
              return { ...conv, unread_count: (chatMsgs || []).filter((m: any) => m.sender_id !== user.id && !m.metadata?.isRead).length || 0 };
            }
            const last = conv.messages?.[conv.messages.length - 1];
            if (!last || last.sender_id === user.id || isReadByReceipt) return { ...conv, unread_count: 0 };
            const unread = (conv.messages || []).filter(
              (m: any) => m.sender_id !== user.id && (!m.is_read || !m.read_by?.includes(user.id))
            ).length;
            return { ...conv, unread_count: unread || 0 };
          })
        );

        const transformed: Conversation[] = withCounts.map((conv) => {
          const otherId = conv.participant_ids?.find((id: string) => id !== user.id);
          if (conv.type === "business") {
            const ctx = conv.context as any;
            return {
              id: conv.id, type: "business",
              participantId: conv.business_id || conv.id,
              participantName: conv.business_name || "Business",
              participantAvatar: conv.business_logo || "/placeholder.svg",
              lastMessage: conv.last_message_text || conv.last_message || "Tap to chat",
              timestamp: conv.updated_at || conv.created_at,
              unreadCount: conv.unread_count || 0, isOnline: false,
              context: {
                businessId: conv.business_id, businessName: conv.business_name,
                businessLogo: conv.business_logo, catalog_item_id: ctx?.catalog_item_id,
                itemId: conv.item_id, itemTitle: conv.item_title,
                itemImage: conv.item_image, itemPrice: conv.item_price,
              },
            };
          }
          if (conv.type === "marketplace") {
            return {
              id: conv.id, type: "marketplace",
              participantId: otherId || conv.id, participantName: conv.item_title || "Marketplace",
              participantAvatar: conv.item_image || "/placeholder.svg",
              lastMessage: conv.last_message_text || conv.last_message || "Tap to chat",
              timestamp: conv.updated_at || conv.created_at,
              unreadCount: conv.unread_count || 0, isOnline: false,
              context: { itemTitle: conv.item_title, itemImage: conv.item_image, itemPrice: conv.item_price },
            };
          }
          return {
            id: conv.id, type: "friend",
            participantId: otherId || conv.id, participantName: "Neighbour",
            participantAvatar: "/placeholder.svg",
            lastMessage: conv.last_message_text || conv.last_message || "Tap to chat",
            timestamp: conv.updated_at || conv.created_at,
            unreadCount: conv.unread_count || 0, isOnline: false, context: conv.context,
          };
        });

        const deduped = deduplicateConversations(transformed);
        setConversations(deduped);

        // Fetch user profiles for friend and marketplace conversations
        const friendIds = transformed
          .filter((c) => c.type !== "business")
          .map((c) => c.participantId)
          .filter((id) => id && id !== user.id);
        if (friendIds.length > 0) {
          const { data: usersData } = await supabase
            .from("users").select("id, name, avatar_url").in("id", friendIds);
          if (usersData) {
            setConversations((prev) =>
              prev.map((c) => {
                if (c.type === "business") return c;
                const u = usersData.find((u) => u.id === c.participantId);
                return u ? { ...c, participantName: u.name || c.participantName, participantAvatar: u.avatar_url || c.participantAvatar } : c;
              })
            );
          }
        }
        setLoading(false);
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    };
    fetchConversations();

    const ch = supabase.channel("conversations")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `participant_ids.cs.{${user.id}}` }, fetchConversations)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (profile?.blocked_users && profile.blocked_users.includes(c.participantId)) return false;

      const tabOk =
        activeTab === "all" ||
        (activeTab === "friends" && c.type === "friend") ||
        (activeTab === "marketplace" && c.type === "marketplace") ||
        (activeTab === "business" && c.type === "business");
      const searchOk = !searchQuery ||
        c.participantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase());
      return tabOk && searchOk;
    });
  }, [conversations, activeTab, searchQuery, profile?.blocked_users]);

  const unreadCounts = useMemo(() => ({
    all: conversations.reduce((s, c) => s + c.unreadCount, 0),
    friends: conversations.filter((c) => c.type === "friend").reduce((s, c) => s + c.unreadCount, 0),
    marketplace: conversations.filter((c) => c.type === "marketplace").reduce((s, c) => s + c.unreadCount, 0),
    business: conversations.filter((c) => c.type === "business").reduce((s, c) => s + c.unreadCount, 0),
  }), [conversations]);

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;
    try {
      const { data: currentData } = await supabase.from('conversations').select('deleted_by').eq('id', convId).single();
      const newDeletedBy = Array.from(new Set([...(currentData?.deleted_by || []), user.id]));
      await supabase.from('conversations').update({ deleted_by: newDeletedBy }).eq('id', convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      toast({ title: "Conversation deleted" });
    } catch (err) {
      toast({ title: "Failed to delete conversation", variant: "destructive" });
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "friends", label: "Friends" },
    { key: "marketplace", label: "Marketplace" },
    { key: "business", label: "Business" },
  ];

  // Fetch friends when user opens the dialog
  useEffect(() => {
    if (!user || !isNewMessageOpen) return;
    const loadFriends = async () => {
      setFriendsLoading(true);
      try {
        const { data: userData } = await supabase.from('users').select('friends').eq('id', user.id).single();
        const friendIds = userData?.friends || [];
        if (friendIds.length > 0) {
          const { data: friendsData } = await supabase.from('users').select('id, name, avatar_url').in('id', friendIds);
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
        .from('conversations')
        .select('id, type')
        .contains('participant_ids', sortedIds);
      
      const existing = existingConvs?.find(c => c.type === 'friend');
      let cid: string;

      if (!existing) {
        const { data: newConv, error } = await supabase
          .from('conversations')
          .insert({
            participant_ids: sortedIds,
            type: 'friend',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select('id')
          .single();
        if (error) throw error;
        cid = newConv.id;
      } else {
        cid = existing.id;
      }

      setIsNewMessageOpen(false);
      router.push(`/messages/${cid}`);
    } catch (err) {
      toast({ title: "Failed to start chat", variant: "destructive" });
    }
  };

  return (
    <div className="w-full max-w-[430px] mx-auto min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body px-4 pt-4 pb-24">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-foreground font-yrdly-display">Messages</h1>
        <Dialog open={isNewMessageOpen} onOpenChange={setIsNewMessageOpen}>
          <DialogTrigger asChild>
            <button className="w-9 h-9 rounded-full bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] flex items-center justify-center text-foreground hover:bg-white/10 transition-all">
              <Edit className="w-4 h-4 text-primary" />
            </button>
          </DialogTrigger>
          <DialogContent className="bg-[var(--yrdly-dark)] border border-[var(--yrdly-glass-border)] text-foreground font-yrdly-body max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle className="font-yrdly-display font-bold text-lg">New Message</DialogTitle>
            </DialogHeader>
            <div className="py-2 max-h-[300px] overflow-y-auto space-y-1">
              {friendsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : friends.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--yrdly-label)] font-yrdly-body">
                  You have no connections to message yet.
                </div>
              ) : (
                friends.map(friend => (
                  <button
                    key={friend.id}
                    onClick={() => handleStartChat(friend.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors text-left"
                  >
                    <Avatar className="w-10 h-10 border border-[var(--yrdly-glass-border)]">
                      <AvatarImage src={friend.avatar_url || "/placeholder.svg"} />
                      <AvatarFallback className="bg-primary text-foreground font-bold font-yrdly-display">
                        {friend.name?.charAt(0) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 overflow-hidden">
                      <p className="font-bold text-sm truncate text-foreground font-yrdly-display">{friend.name}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search Input Bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--yrdly-label)]" />
        <input
          type="text"
          placeholder="Search messages..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-full py-2.5 pl-10 pr-4 text-sm text-foreground outline-none border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] placeholder:text-[var(--yrdly-label)] font-yrdly-body"
        />
      </div>

      {/* Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-hide">
        {TABS.map(({ key, label }) => {
          const isActive = activeTab === key;
          const count = unreadCounts[key];
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "relative whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition-all shrink-0 border",
                isActive
                  ? "bg-[var(--yrdly-glass-bg)] text-foreground border-[var(--yrdly-glass-border)] font-yrdly-display"
                  : "bg-transparent text-[var(--yrdly-label)] border-[var(--yrdly-glass-border)] hover:text-foreground font-yrdly-body"
              )}
            >
              {label}
              {count > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 text-[10px] rounded-full bg-primary text-foreground font-bold">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Conversation List */}
      <div className="space-y-2.5">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <GlassCard key={i} className="flex items-center gap-3 p-3.5 rounded-[16px]">
              <Skeleton className="w-12 h-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </GlassCard>
          ))
        ) : filteredConversations.length === 0 ? (
          <GlassCard className="flex flex-col items-center justify-center py-20 text-center rounded-3xl">
            <MessageCircle className="w-12 h-12 mb-3 text-primary opacity-40" />
            <h3 className="text-foreground text-base font-bold mb-1 font-yrdly-display">No conversations</h3>
            <p className="text-xs text-[var(--yrdly-label)] font-yrdly-body">
              {searchQuery ? "No matching messages found" : "Start chatting with your neighbors"}
            </p>
          </GlassCard>
        ) : (
          filteredConversations.map((conv) => {
            const isMarketplace = conv.type === "marketplace";
            const isBusiness = conv.type === "business";
            const hasItemContext = isMarketplace || isBusiness;
            const unread = conv.unreadCount > 0;

            return (
              <Link key={conv.id} href={`/messages/${conv.id}`}>
                <GlassCard className="group flex items-center gap-3.5 p-3.5 rounded-[18px] transition-all hover:scale-[1.01]">
                  {/* Avatar / Thumbnail */}
                  <div className="relative w-12 h-12 flex-shrink-0">
                    {hasItemContext && conv.context?.itemImage ? (
                      <Image
                        src={conv.context.itemImage}
                        alt=""
                        width={48} height={48}
                        className="w-full h-full object-cover rounded-xl border border-[var(--yrdly-glass-border)]"
                      />
                    ) : (
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={conv.participantAvatar} className="object-cover" />
                        <AvatarFallback className="bg-primary text-foreground font-bold font-yrdly-display">
                          {conv.participantName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    {!hasItemContext && (
                      <div className="absolute -bottom-0.5 -right-0.5">
                        <ActivityIndicator userId={conv.participantId} size="sm" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <span className="text-foreground text-sm font-bold truncate font-yrdly-display">
                        {conv.participantName}
                      </span>
                      <span
                        className={cn(
                          "text-[0.7rem] flex-shrink-0 ml-2 font-yrdly-body",
                          unread ? "text-primary font-bold" : "text-[var(--yrdly-label)]"
                        )}
                      >
                        {timeLabel(conv.timestamp)}
                      </span>
                    </div>
                    {typeof conv.context?.itemPrice === "number" && (
                      <div className="text-xs font-bold mb-0.5 text-primary font-yrdly-display">
                        {conv.context.itemPrice === 0 ? "Free" : `₦${conv.context.itemPrice.toLocaleString()}`}
                      </div>
                    )}
                    <p className={cn("text-xs truncate font-yrdly-body", unread ? "text-foreground font-semibold" : "text-[var(--yrdly-label)]")}>
                      {conv.lastMessage}
                    </p>
                  </div>

                  {/* Actions & Unread */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={(e) => handleDeleteConversation(conv.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--yrdly-label)] hover:text-red-500 transition-all"
                      title="Delete Conversation"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {unread && (
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-primary" />
                    )}
                  </div>
                </GlassCard>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
