"use client";

import React, { useState, useEffect, Suspense } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  House,
  Users,
  Briefcase,
  Calendar,
  Buildings,
  MapPin,
  ChatCircle,
  Bell,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-supabase-auth";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { NotificationsDropdown } from "@/components/NotificationsDropdown";
import { SearchDialog } from "@/components/SearchDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/lib/supabase";
import { HomeRightSidebar } from "./HomeRightSidebar";
import { cn } from "@/lib/utils";
import { CreatePostDialog } from "@/components/CreatePostDialog";
import { usePosts } from "@/hooks/use-posts";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface MainLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/home", label: "Home", icon: House },
  { href: "/community", label: "Community", icon: Users },
  { href: "/marketplace", label: "Market", icon: Briefcase },
  { href: "/events", label: "Events", icon: Calendar },
  { href: "/businesses", label: "Business", icon: Buildings },
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);

  const isHomePage = pathname === "/home";
  const isPostDetailPage =
    pathname.startsWith("/posts/") &&
    pathname.split("/").filter(Boolean).length === 2;
  const showRightSidebar = isHomePage || isPostDetailPage;
  const isChatPage =
    (pathname.startsWith("/messages/") && pathname !== "/messages") ||
    pathname.includes("/chat");
  const isSubPage = pathname === "/profile/payout-settings";
  const isMapPage = pathname === "/map";

  const currentNavItem = navItems.find(
    (item) =>
      pathname === item.href ||
      (item.href !== "/home" && pathname.startsWith(item.href))
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
          .select("id, type, participant_ids, context, last_message_timestamp")
          .contains("participant_ids", [user.id]);

        if (error) return;

        let unreadChatsCount = 0;

        for (const conv of data || []) {
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

  return (
    <>
      {!isChatPage && !isMapPage && (
        <Topbar
          unreadMessages={unreadMessagesCount}
          unreadNotifications={unreadCount}
          onSearch={() => setShowSearch(true)}
          onNotifications={() => setShowNotifications(!showNotifications)}
          onProfile={() => setShowProfile(!showProfile)}
          profile={profile}
          title={pageTitle}
        />
      )}

      <div
        className={cn(
          "flex min-h-[100dvh] bg-[var(--c-bg)]",
          isChatPage || isMapPage ? "" : "pt-[84px]"
        )}
      >
        {!isChatPage && !isMapPage && (
          <Sidebar
            navItems={navItems}
            pathname={pathname}
            profile={profile}
            onSettings={() => router.push("/settings")}
          />
        )}

        <main
          className={cn(
            "flex-1 w-full min-w-0",
            isMapPage ? "p-0 overflow-hidden" : "px-3 sm:px-4 md:px-6 py-4",
            isChatPage ? "h-[100dvh]" : "",
            !isChatPage && !isMapPage ? "lg:ml-64" : ""
          )}
        >
          <ErrorBoundary>
            {isMapPage ? (
              <div className="w-full h-[100dvh]">{children}</div>
            ) : isChatPage ? (
              <div className="w-full h-full lg:h-[calc(100vh-120px)]">
                {children}
              </div>
            ) : (
              <div className="w-full max-w-[680px] mx-auto lg:max-w-[660px]">
                {children}
              </div>
            )}
          </ErrorBoundary>
        </main>

        {showRightSidebar && <HomeRightSidebar />}
      </div>

      {!isChatPage && !isMapPage && (
        <Suspense fallback={null}>
          <nav
            className="lg:hidden fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-around px-2 bg-card border-t border-border shadow-[0_-2px_8px_rgba(0,0,0,0.08)]"
            style={{
              height: "calc(64px + max(env(safe-area-inset-bottom), 0px))",
              paddingBottom: "max(env(safe-area-inset-bottom), 0px)",
            }}
          >
            {navItems.map(({ href, label, icon: Icon }) => {
              const isActive =
                pathname === href ||
                (href !== "/home" && pathname.startsWith(href));

              return (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center justify-center flex-1 h-full"
                >
                  <div
                    className={cn(
                      "p-2 rounded-xl transition-all duration-300",
                      isActive ? "bg-accent" : "bg-transparent"
                    )}
                  >
                    <Icon
                      className={cn(
                        "w-5 h-5",
                        isActive ? "text-primary" : "text-[#767676]"
                      )}
                      weight={isActive ? "fill" : "bold"}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-[0.5625rem] font-bold tracking-tight mt-1 transition-colors",
                      isActive ? "text-primary" : "text-[#767676]"
                    )}
                    style={{ fontFamily: "var(--font-work-sans)" }}
                  >
                    {label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </Suspense>
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
    </>
  );
}
