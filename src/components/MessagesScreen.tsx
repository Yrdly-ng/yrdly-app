"use client";

import { useState, useEffect, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, MessageCircle, Edit } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import Image from "next/image";
import { ActivityIndicator } from "@/components/ActivityIndicator";

const GREEN = "#388E3C";
const CARD = "var(--c-card)";
const FONT = "Inter, sans-serif";
const PACIFICO = "Pacifico, cursive";

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

type Tab = "all" | "friends" | "marketplace" | "businesses";

export function MessagesScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

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

        const withCounts = await Promise.all(
          (data || []).map(async (conv) => {
            if (conv.type === "marketplace") {
              const { data: chatMsgs } = await supabase
                .from("chat_messages")
                .select("sender_id, created_at")
                .eq("chat_id", conv.id)
                .order("created_at", { ascending: true });
              const last = chatMsgs?.[chatMsgs.length - 1];
              if (!last || last.sender_id === user.id) return { ...conv, unread_count: 0 };
              return { ...conv, unread_count: (chatMsgs || []).filter((m: any) => m.sender_id !== user.id).length };
            }
            const last = conv.messages?.[conv.messages.length - 1];
            if (!last || last.sender_id === user.id) return { ...conv, unread_count: 0 };
            const unread = (conv.messages || []).filter(
              (m: any) => m.sender_id !== user.id && (!m.is_read || !m.read_by?.includes(user.id))
            ).length;
            return { ...conv, unread_count: unread };
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
              lastMessage: conv.last_message_text || conv.last_message || "No messages yet",
              timestamp: new Date(conv.updated_at).toLocaleDateString(),
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
              participantId: otherId || conv.id, participantName: "Unknown User",
              participantAvatar: "/placeholder.svg",
              lastMessage: conv.last_message_text || conv.last_message || "No messages yet",
              timestamp: new Date(conv.updated_at).toLocaleDateString(),
              unreadCount: conv.unread_count || 0, isOnline: false,
              context: { itemTitle: conv.item_title, itemImage: conv.item_image, itemPrice: conv.item_price },
            };
          }
          return {
            id: conv.id, type: "friend",
            participantId: otherId || conv.id, participantName: "Unknown User",
            participantAvatar: "/placeholder.svg",
            lastMessage: conv.last_message_text || conv.last_message || "No messages yet",
            timestamp: new Date(conv.updated_at).toLocaleDateString(),
            unreadCount: conv.unread_count || 0, isOnline: false, context: conv.context,
          };
        });

        const deduped = deduplicateConversations(transformed);
        setConversations(deduped);

        // Resolve participant names/avatars
        const friendIds = transformed
          .filter((c) => c.type !== "business")
          .map((c) => c.participantId)
          .filter((id) => id !== user.id);
        if (friendIds.length > 0) {
          const { data: usersData } = await supabase
            .from("users").select("id, name, avatar_url").in("id", friendIds);
          if (usersData) {
            setConversations((prev) =>
              prev.map((c) => {
                if (c.type === "business") return c;
                const u = usersData.find((u) => u.id === c.participantId);
                return u ? { ...c, participantName: u.name || "Unknown", participantAvatar: u.avatar_url || "/placeholder.svg" } : c;
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
      const tabOk =
        activeTab === "all" ||
        (activeTab === "friends" && c.type === "friend") ||
        (activeTab === "marketplace" && c.type === "marketplace") ||
        (activeTab === "businesses" && c.type === "business");
      const searchOk = !searchQuery ||
        c.participantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase());
      return tabOk && searchOk;
    });
  }, [conversations, activeTab, searchQuery]);

  const unreadCounts = useMemo(() => ({
    all: conversations.reduce((s, c) => s + c.unreadCount, 0),
    friends: conversations.filter((c) => c.type === "friend").reduce((s, c) => s + c.unreadCount, 0),
    marketplace: conversations.filter((c) => c.type === "marketplace").reduce((s, c) => s + c.unreadCount, 0),
    businesses: conversations.filter((c) => c.type === "business").reduce((s, c) => s + c.unreadCount, 0),
  }), [conversations]);

  const TABS: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "friends", label: "Friends" },
    { key: "marketplace", label: "Marketplace" },
    { key: "businesses", label: "Business" },
  ];

  return (
    <div className="min-h-[100dvh]" style={{ background: "var(--c-bg)" }}>
      {/* Sticky Header */}
      <div
        className="sticky top-0 z-40 px-4 pt-5 pb-4 space-y-4"
        style={{ background: 'var(--c-card)', borderRadius: "0 0 11px 11px", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}
      >
        <div className="flex justify-between items-center">
          <h1 className="text-[1.125rem] text-foreground" style={{ fontFamily: PACIFICO }}>Messages</h1>
          <Edit className="w-5 h-5" style={{ color: GREEN }} />
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(137,148,133,0.6)" }} />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-full py-3 pl-11 pr-4 text-sm text-foreground outline-none"
            style={{ background: "var(--c-card2)", border: "0.5px solid rgba(130,219,126,0.4)", fontFamily: FONT }}
          />
        </div>

        {/* Filter Tabs */}
        <div
          className="flex items-center gap-1 p-1 overflow-x-auto"
          style={{ border: "0.5px solid rgba(130,219,126,0.3)", borderRadius: 9999, background: "var(--c-bg)" }}
        >
          {TABS.map(({ key, label }) => {
            const isActive = activeTab === key;
            const count = unreadCounts[key] || unreadCounts[key === "businesses" ? "businesses" : key as keyof typeof unreadCounts];
            return (
              <div key={key} className="relative flex-shrink-0">
                <button
                  onClick={() => setActiveTab(key)}
                  className="whitespace-nowrap rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                  style={{
                    background: isActive ? "var(--c-card2)" : "transparent",
                    color: isActive ? GREEN : "#9ca3af",
                    fontFamily: FONT,
                  }}
                >
                  {label}
                </button>
                {unreadCounts[key as keyof typeof unreadCounts] > 0 && (
                  <span
                    className="absolute top-0 right-0 w-2 h-2 rounded-full"
                    style={{ background: GREEN, border: "1px solid var(--c-border)" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="px-4 mt-4 pb-24 space-y-3">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4" style={{ background: 'var(--c-card)', borderRadius: 11 }}>
              <Skeleton className="w-14 h-14 rounded-[11px]" style={{ background: "var(--c-card2)" }} />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" style={{ background: "var(--c-card2)" }} />
                <Skeleton className="h-3 w-48" style={{ background: "var(--c-card2)" }} />
              </div>
            </div>
          ))
        ) : filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageCircle className="w-12 h-12 mb-4" style={{ color: GREEN, opacity: 0.4 }} />
            <h3 className="text-foreground text-lg mb-1" style={{ fontFamily: PACIFICO }}>No conversations</h3>
            <p className="text-sm" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
              {searchQuery ? "No matches found" : "Start chatting with your neighbors"}
            </p>
          </div>
        ) : (
          filteredConversations.map((conv) => {
            const isMarketplace = conv.type === "marketplace";
            const isBusiness = conv.type === "business";
            const hasItemContext = isMarketplace || isBusiness;
            const unread = conv.unreadCount > 0;

            return (
              <Link key={conv.id} href={`/messages/${conv.id}`}>
                <div
                  className="flex items-center gap-3 p-4 transition-colors"
                  style={{
                    background: 'var(--c-card)',
                    borderRadius: 11,
                    borderLeft: unread ? `4px solid ${GREEN}` : "4px solid transparent",
                  }}
                >
                  {/* Avatar / Thumbnail */}
                  <div className="relative w-14 h-14 flex-shrink-0">
                    {hasItemContext && conv.context?.itemImage ? (
                      <Image
                        src={conv.context.itemImage}
                        alt=""
                        width={56} height={56}
                        className="w-full h-full object-cover"
                        style={{ borderRadius: 11 }}
                      />
                    ) : (
                      <Avatar className="w-14 h-14">
                        <AvatarImage src={conv.participantAvatar} />
                        <AvatarFallback style={{ background: GREEN, color: "#fff", fontFamily: FONT, fontWeight: 700 }}>
                          {conv.participantName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    {/* Online dot */}
                    {!hasItemContext && (
                      <div className="absolute -bottom-0.5 -right-0.5">
                        <ActivityIndicator userId={conv.participantId} size="sm" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-0.5">
                      <span className="text-foreground text-[0.875rem] truncate" style={{ fontFamily: FONT, fontWeight: 700 }}>
                        {conv.participantName}
                      </span>
                      <span
                        className="text-[0.625rem] flex-shrink-0 ml-2"
                        style={{ color: unread ? GREEN : "var(--c-text-muted)", fontFamily: FONT, fontWeight: unread ? 700 : 400 }}
                      >
                        {conv.timestamp}
                      </span>
                    </div>
                    {conv.context?.itemPrice && (
                      <div className="text-[0.75rem] font-bold mb-0.5" style={{ color: "#6edf51", fontFamily: FONT }}>
                        ₦{conv.context.itemPrice.toLocaleString()}
                      </div>
                    )}
                    <p className="text-[0.75rem] truncate" style={{ color: unread ? "var(--c-text)" : "var(--c-text-muted)", fontFamily: FONT, fontWeight: unread ? 500 : 400 }}>
                      {conv.lastMessage}
                    </p>
                  </div>

                  {/* Unread dot */}
                  {unread && (
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: GREEN }} />
                  )}
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
