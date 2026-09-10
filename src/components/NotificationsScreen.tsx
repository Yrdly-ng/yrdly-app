"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell,
  UserPlus,
  MessageSquare,
  Heart,
  Calendar,
  ShoppingBag,
  Check,
  X,
  ArrowLeft,
  Trash2,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { useFriendshipContext } from "@/contexts/FriendshipContext";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const GREEN = "#82DB7E";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  data?: any;
  is_read: boolean;
  created_at: string;
  from_user_id?: string;
  from_user_name?: string;
  from_user_avatar?: string;
  related_id?: string;
}

const FILTER_TABS = ["All", "Alerts", "Community", "Unread", "Marketplace", "Events"];

function timeAgo(dateString: string): string {
  try {
    const d = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays === 1) return "Yesterday";
    return `${diffDays}d ago`;
  } catch {
    return "";
  }
}

export function NotificationsScreen() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const { refreshUserStatus } = useFriendshipContext();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All");

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error || !data) return;

      const senderIds = Array.from(
        new Set(data.map((n) => n.sender_id || n.data?.from_user_id).filter(Boolean))
      );
      let senderMap = new Map();
      if (senderIds.length > 0) {
        const { data: senders } = await supabase
          .from("users")
          .select("id, name, avatar_url")
          .in("id", senderIds);
        if (senders) {
          senderMap = new Map(senders.map((s) => [s.id, s]));
        }
      }

      const formatted = data.map((notif: any) => {
        const sId = notif.sender_id || notif.data?.from_user_id;
        const sender = sId ? senderMap.get(sId) : null;

        return {
          id: notif.id,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          data: notif.data,
          is_read: notif.is_read,
          created_at: notif.created_at,
          from_user_id: sId,
          from_user_name: sender?.name || notif.data?.fromUserName || notif.data?.from_user_name,
          from_user_avatar: sender?.avatar_url || notif.data?.from_user_avatar,
          related_id: notif.related_id,
        };
      }) as Notification[];

      setNotifications(formatted);
    } catch (e) {
      console.error("Fetch notifications error:", e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();

    if (!user) return;
    const channel = supabase
      .channel("notifications_realtime_web")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => fetchNotifications()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchNotifications]);

  const markAllRead = async () => {
    if (!user) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id);
    toast({ title: "All marked as read" });
  };

  const handleMarkAsRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
  };

  const handleAcceptFriend = async (notification: Notification, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    try {
      const fromUserId = notification.from_user_id;
      if (!fromUserId) return;

      // Reciprocal follow relationship
      await supabase.from("followers").insert({
        follower_id: user.id,
        following_id: fromUserId,
      });

      await refreshUserStatus(fromUserId);
      await handleMarkAsRead(notification.id);
      toast({ title: "Friend request accepted! 🎉" });
    } catch {
      toast({ variant: "destructive", title: "Error accepting request." });
    }
  };

  const handleDeclineFriend = async (notification: Notification, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || !notification.from_user_id) return;
    try {
      await supabase
        .from("followers")
        .delete()
        .eq("follower_id", notification.from_user_id)
        .eq("following_id", user.id);

      await refreshUserStatus(notification.from_user_id);
      await handleMarkAsRead(notification.id);
      toast({ title: "Request declined" });
    } catch {
      toast({ variant: "destructive", title: "Error declining request." });
    }
  };

  const handleNotificationClick = (item: Notification) => {
    if (!item.is_read) handleMarkAsRead(item.id);
    const t = item.type || "";
    if (t.includes("event")) {
      if (item.related_id) router.push(`/events/${item.related_id}`);
      else router.push("/events");
    } else if (t.includes("marketplace") || t.includes("escrow")) {
      if (item.related_id) router.push(`/marketplace/${item.related_id}`);
      else router.push("/marketplace");
    } else if (t === "message") {
      if (item.related_id) router.push(`/messages/${item.related_id}`);
      else router.push("/messages");
    } else if (
      [
        "payment_successful",
        "item_shipped",
        "delivery_confirmed",
        "funds_released",
        "dispute_opened",
        "dispute_resolved",
        "payout_processed",
        "payout_failed",
      ].includes(t)
    ) {
      if (item.related_id) router.push(`/transactions/${item.related_id}`);
      else router.push("/transactions");
    } else if (["friend_request", "friend_request_accepted", "new_follower"].includes(t)) {
      const profileId = item.from_user_id || item.related_id;
      if (profileId) router.push(`/profile/${profileId}`);
      else router.push("/explore");
    } else if (t.includes("alert") || t.includes("safety")) {
      if (item.related_id) router.push(`/admin/create-alert`);
      else router.push("/explore");
    } else if (t === "post_comment" || t === "post_like") {
      if (item.related_id) router.push(`/posts/${item.related_id}`);
    } else {
      router.push("/explore");
    }
  };

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      const t = n.type || "";
      if (activeFilter === "Unread") return !n.is_read;
      if (activeFilter === "Alerts") return t.includes("alert") || t.includes("safety");
      if (activeFilter === "Community")
        return [
          "friend_request",
          "friend_accept",
          "new_follower",
          "post_like",
          "post_comment",
        ].includes(t);
      if (activeFilter === "Marketplace")
        return (
          t.includes("marketplace") ||
          t.includes("escrow") ||
          t.includes("transaction") ||
          [
            "payment_successful",
            "item_shipped",
            "delivery_confirmed",
            "funds_released",
            "dispute_opened",
            "dispute_resolved",
            "payout_processed",
            "payout_failed",
          ].includes(t)
        );
      if (activeFilter === "Events") return t.includes("event") || t.includes("ticket");
      return true;
    });
  }, [notifications, activeFilter]);

  return (
    <div className="w-full max-w-2xl mx-auto min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body pb-24">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full bg-surface border border-[var(--yrdly-glass-border)] flex items-center justify-center text-foreground hover:bg-white/5 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-xl font-extrabold text-foreground font-yrdly-display">Notifications</h1>
        </div>
        <button
          type="button"
          onClick={markAllRead}
          className="px-3 py-1.5 rounded-xl border border-[var(--yrdly-glass-border)] bg-surface text-xs font-bold text-[#82DB7E] hover:bg-white/5 transition-all"
        >
          Mark Read
        </button>
      </div>

      {/* ── Filter Pills ── */}
      <div className="px-5 mb-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {FILTER_TABS.map((item) => {
            const active = activeFilter === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setActiveFilter(item)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-semibold transition-all border flex-shrink-0",
                  active
                    ? "bg-[#82DB7E]/10 border-[#82DB7E]/30 text-[#82DB7E] font-bold"
                    : "bg-transparent border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)] hover:text-foreground"
                )}
              >
                {item}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Notifications List ── */}
      {loading ? (
        <div className="space-y-2 px-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-3.5 p-3.5 rounded-2xl border border-[var(--yrdly-glass-border)] bg-card">
              <Skeleton className="w-11 h-11 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface border border-[var(--yrdly-glass-border)] flex items-center justify-center mb-4">
            <Bell className="w-8 h-8 text-[var(--yrdly-label)]" />
          </div>
          <h3 className="text-lg font-bold font-yrdly-display text-foreground mb-1">No notifications</h3>
          <p className="text-sm text-[var(--yrdly-label)] max-w-xs">
            You&apos;re all caught up with your neighbourhood updates.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-surface">
          {filteredNotifications.map((item) => {
            const isUnread = !item.is_read;
            const isFriendRequest = item.type === "friend_request";

            return (
              <div
                key={item.id}
                onClick={() => handleNotificationClick(item)}
                className={cn(
                  "group flex items-start gap-3.5 px-5 py-3.5 cursor-pointer transition-colors hover:bg-white/5",
                  isUnread && "bg-[#82DB7E]/[0.03]"
                )}
              >
                {/* Avatar / Icon */}
                <div className="relative w-11 h-11 flex-shrink-0">
                  {item.from_user_avatar ? (
                    <Avatar className="w-11 h-11">
                      <AvatarImage src={item.from_user_avatar} />
                      <AvatarFallback className="bg-[#82DB7E]/10 text-[#82DB7E] font-bold font-yrdly-display">
                        {item.from_user_name?.charAt(0).toUpperCase() || "N"}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-[#82DB7E]/10 border border-[#82DB7E]/20 flex items-center justify-center">
                      <Bell className="w-5 h-5 text-[#82DB7E]" />
                    </div>
                  )}
                  {isUnread && (
                    <div className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-[#82DB7E] border-2 border-[var(--yrdly-dark)]" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span
                      className={cn(
                        "text-sm font-semibold truncate text-foreground font-yrdly-display",
                        isUnread && "font-extrabold"
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="text-xs font-mono text-[var(--yrdly-label)] flex-shrink-0">
                      {timeAgo(item.created_at)}
                    </span>
                  </div>

                  <p
                    className={cn(
                      "text-xs leading-relaxed font-yrdly-body",
                      isUnread ? "text-foreground font-medium" : "text-[var(--yrdly-label)]"
                    )}
                  >
                    {item.message}
                  </p>

                  {/* Friend request actions */}
                  {isFriendRequest && (
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        type="button"
                        onClick={(e) => handleAcceptFriend(item, e)}
                        className="px-4 py-1.5 rounded-full text-xs font-extrabold text-black transition-opacity hover:opacity-90 flex items-center gap-1.5"
                        style={{ backgroundColor: GREEN }}
                      >
                        <Check size={14} />
                        <span>Accept</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeclineFriend(item, e)}
                        className="px-4 py-1.5 rounded-full text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
                      >
                        <X size={14} />
                        <span>Decline</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={(e) => handleDelete(item.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-[var(--yrdly-label)] hover:text-red-500 hover:bg-red-500/10 transition-all flex-shrink-0"
                  title="Delete Notification"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
