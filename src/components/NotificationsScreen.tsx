"use client";

import { useState, useEffect, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell,
  UserPlus,
  MessageCircle,
  Heart,
  Calendar,
  ShoppingCart,
  Check,
  X,
  ChevronLeft,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { useFriendshipContext } from "@/contexts/FriendshipContext";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNowStrict } from "date-fns";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const GREEN = "#388E3C";
const GREEN_LIGHT = "#82DB7E";
const CARD = "var(--c-card)";
const SURFACE = "var(--c-card)";
const BG = "var(--c-bg)";
const FONT = "Inter, sans-serif";
const PACIFICO = "Pacifico, cursive";

interface NotificationsScreenProps {
  className?: string;
}

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

function NotificationIcon({ type }: { type: string }) {
  const iconClass = "w-5 h-5";
  switch (type) {
    case "friend_request":
    case "friend_request_accepted":
      return <UserPlus className={iconClass} style={{ color: GREEN_LIGHT }} />;
    case "message":
    case "message_reaction":
      return <MessageCircle className={iconClass} style={{ color: "#60a5fa" }} />;
    case "post_like":
      return <Heart className={iconClass} style={{ color: "#f87171" }} />;
    case "post_comment":
      return <MessageCircle className={iconClass} style={{ color: "#c084fc" }} />;
    case "event_invite":
    case "event_reminder":
      return <Calendar className={iconClass} style={{ color: "#fb923c" }} />;
    case "marketplace_item_sold":
    case "marketplace_item_interest":
      return <ShoppingCart className={iconClass} style={{ color: GREEN_LIGHT }} />;
    default:
      return <Bell className={iconClass} style={{ color: "var(--c-text-muted)" }} />;
  }
}

function NotificationCard({
  notification,
  onMarkAsRead,
  onDelete,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const { refreshUserStatus } = useFriendshipContext();

  const handleAcceptFriend = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const toUserId = currentUser?.id || "";
      let fromUserId = notification.from_user_id || "";

      if (!fromUserId && toUserId) {
        const { data: pending } = await supabase
          .from("friend_requests")
          .select("id, from_user_id")
          .eq("to_user_id", toUserId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1);
        if (pending && pending.length >= 1) {
          fromUserId = pending[0].from_user_id;
        }
      }

      if (!fromUserId) {
        toast({ title: "Request not found", variant: "destructive" });
        return;
      }

      const { data: req } = await supabase
        .from("friend_requests")
        .select("id")
        .eq("from_user_id", fromUserId)
        .eq("to_user_id", toUserId)
        .eq("status", "pending")
        .maybeSingle();

      if (!req) {
        toast({ title: "Request not found", variant: "destructive" });
        return;
      }

      const { error: rpcError } = await supabase.rpc("accept_friend_request", {
        req_id: req.id,
      });

      if (rpcError) {
        throw rpcError;
      }

      // Refresh global friendship context so profile buttons update everywhere
      if (fromUserId) await refreshUserStatus(fromUserId);
      onMarkAsRead(notification.id);
      toast({ title: "Friend request accepted", description: "You are now friends! 🎉" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not accept request." });
    }
  };

  const handleDeclineFriend = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (!currentUser || !notification.from_user_id) return;
      await supabase
        .from("friend_requests")
        .delete()
        .eq("from_user_id", notification.from_user_id)
        .eq("to_user_id", currentUser.id)
        .eq("status", "pending");
      // Refresh global friendship context so profile buttons update everywhere
      await refreshUserStatus(notification.from_user_id);
      onMarkAsRead(notification.id);
      toast({ title: "Request declined" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not decline request." });
    }
  };

  const handleCardClick = () => {
    if (!notification.is_read) onMarkAsRead(notification.id);
    switch (notification.type) {
      case "friend_request":
      case "friend_request_accepted":
      case "friend_request_declined": {
        const uid = notification.from_user_id || notification.related_id;
        router.push(uid ? `/profile/${uid}` : "/community");
        break;
      }
      case "message":
      case "message_reaction": {
        const cid = notification.related_id || notification.data?.conversation_id;
        router.push(cid ? `/messages/${cid}` : "/messages");
        break;
      }
      case "post_like":
      case "post_comment":
      case "post_share": {
        const pid = notification.related_id || notification.data?.post_id;
        router.push(pid ? `/posts/${pid}` : "/home");
        break;
      }
      case "event_invite":
      case "event_reminder": {
        const eid = notification.related_id || notification.data?.post_id;
        router.push(eid ? `/events/${eid}` : "/events");
        break;
      }
      default:
        router.push("/home");
    }
  };

  const isUnread = !notification.is_read;
  const isFriendRequest = notification.type === "friend_request";

  return (
    <div
      className="relative rounded-[11px] overflow-hidden cursor-pointer transition-all active:scale-[0.99]"
      style={{
        background: isUnread ? "var(--c-card)" : CARD,
        border: isUnread
          ? "0.5px solid rgba(130,219,126,0.3)"
          : "0.5px solid var(--c-border)",
      }}
      onClick={handleCardClick}
    >
      {/* Unread indicator stripe */}
      {isUnread && (
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5"
          style={{ background: GREEN_LIGHT }}
        />
      )}

      <div className="flex items-start gap-3 p-4">
        {/* Avatar or icon */}
        <div className="flex-shrink-0 relative">
          {notification.from_user_avatar || notification.from_user_name ? (
            <Avatar className="w-10 h-10">
              <AvatarImage src={notification.from_user_avatar} />
              <AvatarFallback
                style={{ background: GREEN, color: "#fff", fontFamily: FONT, fontWeight: 700 }}
              >
                {notification.from_user_name?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "rgba(56,142,60,0.15)" }}
            >
              <NotificationIcon type={notification.type} />
            </div>
          )}
          {/* Type icon badge on avatar */}
          {(notification.from_user_avatar || notification.from_user_name) && (
            <div
              className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: "var(--c-card)", border: "1px solid var(--c-bg)" }}
            >
              <NotificationIcon type={notification.type} />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p
            className="text-[0.8125rem] text-foreground leading-snug"
            style={{ fontFamily: FONT, fontWeight: isUnread ? 600 : 400 }}
          >
            <span style={{ fontWeight: 700 }}>
              {notification.from_user_name || notification.title}
            </span>{" "}
            {notification.from_user_name ? notification.message : ""}
          </p>
          {!notification.from_user_name && (
            <p className="text-[0.75rem] mt-0.5" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
              {notification.message}
            </p>
          )}
          <p className="text-[0.6875rem] mt-1" style={{ color: "#566052", fontFamily: FONT }}>
            {formatDistanceToNowStrict(new Date(notification.created_at), { addSuffix: true })}
          </p>

          {/* Friend request inline actions */}
          {isFriendRequest && (
            <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={handleAcceptFriend}
                className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold text-foreground transition-all active:scale-95"
                style={{ background: GREEN, fontFamily: FONT }}
              >
                <Check className="w-3.5 h-3.5" />
                Accept
              </button>
              <button
                onClick={handleDeclineFriend}
                className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-all active:scale-95"
                style={{
                  background: "rgba(229,57,53,0.12)",
                  color: "#E53935",
                  border: "0.5px solid rgba(229,57,53,0.3)",
                  fontFamily: FONT,
                }}
              >
                <X className="w-3.5 h-3.5" />
                Decline
              </button>
            </div>
          )}
        </div>

        {/* Right side: unread dot + delete */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {isUnread && (
            <div className="w-2 h-2 rounded-full" style={{ background: GREEN_LIGHT }} />
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded-full transition-colors hover:bg-accent"
                style={{ color: "#566052" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent
              style={{ background: 'var(--c-card)', border: "0.5px solid var(--c-border)" }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle className="text-foreground">Delete notification?</AlertDialogTitle>
                <AlertDialogDescription style={{ color: "var(--c-text-muted)" }}>
                  This will permanently remove this notification.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  style={{ background: "var(--c-card)", border: "1px solid var(--c-border)", color: "var(--c-text)" }}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  style={{ background: "#E53935" }}
                  onClick={() => onDelete(notification.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

const FILTER_TABS = ["All", "Unread", "Friend Requests", "Messages", "Activity"];

export function NotificationsScreen({ className }: NotificationsScreenProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All");

  useEffect(() => {
    if (!user) return;

    const fetchNotifications = async () => {
      try {
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) return;

        const rawData = data || [];
        const senderIds = Array.from(new Set(rawData.map(n => n.sender_id || n.data?.from_user_id).filter(Boolean)));
        let senderMap = new Map();
        if (senderIds.length > 0) {
          const { data: senders } = await supabase.from('users').select('id, name, avatar_url').in('id', senderIds);
          if (senders) senderMap = new Map(senders.map(s => [s.id, s]));
        }

        const formatted = rawData.map((notif) => {
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
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };

    fetchNotifications();

    const channel = supabase
      .channel("notifications_screen")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const n = payload.new as any;
            setNotifications((prev) => [
              {
                id: n.id,
                type: n.type,
                title: n.title,
                message: n.message,
                data: n.data,
                is_read: n.is_read,
                created_at: n.created_at,
                from_user_id: n.sender_id || n.data?.from_user_id,
                from_user_name: n.data?.fromUserName || n.data?.from_user_name,
                from_user_avatar: n.data?.from_user_avatar,
                related_id: n.related_id,
              },
              ...prev,
            ]);
          } else if (payload.eventType === "UPDATE") {
            const u = payload.new as any;
            setNotifications((prev) =>
              prev.map((n) => (n.id === u.id ? { ...n, is_read: u.is_read } : n))
            );
          } else if (payload.eventType === "DELETE") {
            setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleMarkAsRead = async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    window.dispatchEvent(new Event("notifications_read"));
  };

  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    toast({ title: "All marked as read" });
    window.dispatchEvent(new Event("notifications_read"));
  };

  const handleDelete = async (id: string) => {
    await supabase.from("notifications").delete().eq("id", id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const filteredNotifications = useMemo(() => {
    switch (activeFilter) {
      case "Unread":
        return notifications.filter((n) => !n.is_read);
      case "Friend Requests":
        return notifications.filter((n) => n.type === "friend_request");
      case "Messages":
        return notifications.filter((n) => n.type === "message" || n.type === "message_reaction");
      case "Activity":
        return notifications.filter((n) =>
          ["post_like", "post_comment", "post_share", "event_invite", "event_reminder"].includes(n.type)
        );
      default:
        return notifications;
    }
  }, [notifications, activeFilter]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: BG }}>
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-[1.25rem] text-foreground" style={{ fontFamily: PACIFICO }}>
              Notifications
            </h1>
            <p
              className="text-[0.75rem] mt-0.5"
              style={{ color: "var(--c-text-muted)", fontFamily: FONT, fontStyle: "italic", fontWeight: 300 }}
            >
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up!"}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95"
              style={{
                background: "rgba(56,142,60,0.15)",
                color: GREEN_LIGHT,
                border: "0.5px solid rgba(130,219,126,0.3)",
                fontFamily: FONT,
              }}
            >
              <Check className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </header>

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          {FILTER_TABS.map((tab) => {
            const isActive = activeFilter === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveFilter(tab)}
                className="flex-shrink-0 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all"
                style={
                  isActive
                    ? { background: GREEN, color: "#fff", fontFamily: FONT }
                    : {
                        background: 'var(--c-card)',
                        color: "var(--c-text-muted)",
                        border: "0.5px solid var(--c-border)",
                        fontFamily: FONT,
                      }
                }
              >
                {tab}
                {tab === "Unread" && unreadCount > 0 && (
                  <span
                    className="ml-1.5 inline-flex items-center justify-center rounded-full min-w-[16px] h-4 px-1 text-[0.5625rem] font-bold"
                    style={{ background: GREEN_LIGHT, color: "#003207" }}
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Notifications list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-3 p-4 rounded-[11px]" style={{ background: CARD }}>
                <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" style={{ background: "var(--c-card2)" }} />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-3/4" style={{ background: "var(--c-card2)" }} />
                  <Skeleton className="h-3 w-1/2" style={{ background: "var(--c-card2)" }} />
                </div>
              </div>
            ))}
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
              style={{ background: "rgba(56,142,60,0.1)" }}
            >
              <Bell className="w-9 h-9" style={{ color: GREEN_LIGHT, opacity: 0.5 }} />
            </div>
            <h2 className="text-foreground text-lg mb-2" style={{ fontFamily: PACIFICO }}>
              {activeFilter === "All" ? "No notifications yet" : `No ${activeFilter.toLowerCase()}`}
            </h2>
            <p className="text-[0.8125rem] text-center max-w-xs" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
              {activeFilter === "All"
                ? "You'll see your notifications here."
                : `You have no ${activeFilter.toLowerCase()} notifications.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredNotifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                onMarkAsRead={handleMarkAsRead}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
