"use client";

import React, { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  House,
  Compass,
  ChatCircle,
  User,
} from "@phosphor-icons/react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { NotificationsDropdown } from "@/components/NotificationsDropdown";
import { SearchDialog } from "@/components/SearchDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { AlertService, type Alert } from "@/lib/alert-service";
import { Warning, X, Siren } from "@phosphor-icons/react";
import { CreatePostDialog } from "@/components/CreatePostDialog";
import { CreateMenuOverlay } from "@/components/CreateMenuOverlay";
import { CreateItemDialog } from "@/components/CreateItemDialog";
import { CreateEventDialog } from "@/components/CreateEventDialog";
import { usePosts } from "@/hooks/use-posts";
import { Topbar } from "./Topbar";
import { BottomNav } from "./BottomNav";

interface MainLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/home", label: "Home", icon: House },
  {
    href: "/explore",
    label: "Explore",
    icon: Compass,
    matchPaths: ["/explore", "/marketplace", "/events", "/businesses"],
  },
  { href: "/messages", label: "Messages", icon: ChatCircle },
  { href: "/profile", label: "Profile", icon: User },
];

export function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { createPost } = usePosts();

  const [showProfile, setShowProfile] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [listingDialogOpen, setListingDialogOpen] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [urgentAlert, setUrgentAlert] = useState<Alert | null>(null);
  const [urgentAlertDismissed, setUrgentAlertDismissed] = useState(false);

  const isChatPage =
    (pathname.startsWith("/messages/") && pathname !== "/messages") ||
    pathname.includes("/chat");
  const isMapPage = pathname === "/map";

  const currentNavItem = navItems.find(
    (item) =>
      pathname === item.href ||
      (item.href !== "/home" && pathname.startsWith(item.href)) ||
      (item as { matchPaths?: string[] }).matchPaths?.some((p) =>
        pathname === p || pathname.startsWith(p + "/")
      )
  );
  const pageTitle = currentNavItem?.label || "Home";

  useEffect(() => {
    if (!user) return;

    const fetchUnreadCount = async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (!error) setUnreadCount(count || 0);
    };

    fetchUnreadCount();

    const ch = supabase
      .channel("notification_count")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        fetchUnreadCount
      )
      .subscribe();

    window.addEventListener("notifications_read", fetchUnreadCount);

    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("notifications_read", fetchUnreadCount);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const fetchUnreadMessagesCount = async () => {
      try {
        const { data, error } = await supabase
          .from("conversations")
          .select("id, type, participant_ids, context, last_message_timestamp, deleted_by")
          .contains("participant_ids", [user.id]);

        if (error) return;

        let unreadChatsCount = 0;

        for (const conv of data || []) {
          if (conv.deleted_by?.includes(user.id)) continue;
          const readReceiptStr = conv.context?.read_receipts?.[user.id];
          const readReceiptDate = readReceiptStr
            ? new Date(readReceiptStr).getTime()
            : 0;

          const lastMsgDate = conv.last_message_timestamp
            ? new Date(conv.last_message_timestamp).getTime()
            : 0;

          const isReadByReceipt =
            readReceiptDate >= lastMsgDate && lastMsgDate > 0;

          if (isReadByReceipt) continue;

          if (conv.type === "marketplace") {
            const { data: msgs } = await supabase
              .from("chat_messages")
              .select("sender_id, metadata")
              .eq("chat_id", conv.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (
              msgs &&
              msgs.sender_id !== user.id &&
              !msgs.metadata?.isRead
            ) {
              unreadChatsCount++;
            }
          } else {
            const { data: msgs } = await supabase
              .from("messages")
              .select("sender_id, read_by")
              .eq("conversation_id", conv.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (
              msgs &&
              msgs.sender_id !== user.id &&
              !msgs.read_by?.includes(user.id)
            ) {
              unreadChatsCount++;
            }
          }
        }

        setUnreadMessagesCount(unreadChatsCount);
      } catch {}
    };

    fetchUnreadMessagesCount();

    const ch = supabase
      .channel("conversations_count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        fetchUnreadMessagesCount
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  /* ── Urgent safety alert banner (port of mobile AlertBanner overlay) ── */
  useEffect(() => {
    if (!user) return;

    const checkUrgentAlert = async () => {
      const alert = await AlertService.getActiveAlert();
      setUrgentAlert(alert);
      setUrgentAlertDismissed(() => {
        if (!alert || typeof window === "undefined") return false;
        try {
          return window.sessionStorage.getItem(`yrdly_alert_dismissed_${alert.id}`) === "1";
        } catch {
          return false;
        }
      });
    };

    checkUrgentAlert();

    const ch = supabase
      .channel("safety_alerts_urgent")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "safety_alerts" },
        checkUrgentAlert
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const dismissUrgentAlert = () => {
    if (urgentAlert && typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(`yrdly_alert_dismissed_${urgentAlert.id}`, "1");
      } catch {}
    }
    setUrgentAlertDismissed(true);
  };

  const showUrgentBanner =
    !isChatPage && !isMapPage && !!urgentAlert && !urgentAlertDismissed;

  return (
    <>
      {!isChatPage && !isMapPage && (
        <Topbar
          unreadMessages={unreadMessagesCount}
          unreadNotifications={unreadCount}
          onSearch={() => setShowSearch(true)}
          onNotifications={() => setShowNotifications(!showNotifications)}
          onProfile={() => setShowProfile(!showProfile)}
          onCreate={() => setCreateMenuOpen(true)}
          profile={profile}
          title={pageTitle}
          navItems={navItems}
          pathname={pathname}
        />
      )}

      <div
        className={cn(
          "flex min-h-[100dvh] bg-[var(--c-bg)]",
          isChatPage || isMapPage ? "" : "pt-[64px] md:pt-[84px]"
        )}
      >
        <main
          className={cn(
            "flex-1 w-full min-w-0",
            isMapPage
              ? "p-0 overflow-hidden"
              : "px-3 sm:px-4 md:px-6 py-4",
            isChatPage ? "h-[100dvh]" : "",
            !isChatPage && !isMapPage ? "pb-20 md:pb-4" : ""
          )}
        >
          {showUrgentBanner && urgentAlert && (
            <div
              className="sticky top-[64px] md:top-[84px] z-40 flex items-start gap-3 px-4 py-3 rounded-2xl mb-3 shadow-lg"
              style={{
                background: "rgba(239,68,68,0.10)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderLeft: "3px solid #ef4444",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
              }}
            >
              <Siren size={20} weight="fill" color="#ef4444" className="flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => router.push("/alerts")}
                  className="block text-left text-[0.9375rem] font-bold text-foreground leading-snug hover:underline"
                >
                  {urgentAlert.title}
                </button>
                <p className="text-[0.8125rem] text-[var(--c-text-muted)] leading-snug mt-0.5 line-clamp-2">
                  {urgentAlert.area ? `${urgentAlert.area} · ` : ""}
                  {urgentAlert.description}
                </p>
              </div>
              <button
                onClick={dismissUrgentAlert}
                aria-label="Dismiss alert"
                className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full text-[var(--c-text-muted)] hover:bg-black/10 transition-colors"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
          )}

          <ErrorBoundary>
            {isMapPage ? (
              <div className="w-full h-[100dvh]">{children}</div>
            ) : isChatPage ? (
              <div className="w-full h-full">
                {children}
              </div>
            ) : (
              <div className="w-full max-w-[680px] mx-auto lg:max-w-[660px]">
                {children}
              </div>
            )}
          </ErrorBoundary>
        </main>

      </div>

      {!isChatPage && !isMapPage && (
        <BottomNav
          navItems={navItems}
          pathname={pathname}
          onCreateMenu={() => setCreateMenuOpen(true)}
        />
      )}

      {showProfile && (
        <ProfileDropdown onClose={() => setShowProfile(false)} />
      )}

      <NotificationsDropdown
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      />

      <SearchDialog open={showSearch} onOpenChange={setShowSearch} />

      <CreatePostDialog
        createPost={createPost}
        open={postDialogOpen}
        onOpenChange={setPostDialogOpen}
      />

      <CreateMenuOverlay
        open={createMenuOpen}
        onClose={() => setCreateMenuOpen(false)}
        onPost={() => setPostDialogOpen(true)}
        onListing={() => setListingDialogOpen(true)}
        onEvent={() => setEventDialogOpen(true)}
      />

      <CreateItemDialog
        open={listingDialogOpen}
        onOpenChange={setListingDialogOpen}
      />

      <CreateEventDialog
        open={eventDialogOpen}
        onOpenChange={setEventDialogOpen}
      />
    </>
  );
}