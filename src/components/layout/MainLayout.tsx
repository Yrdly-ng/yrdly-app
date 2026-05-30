"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  House,
  Users,
  Storefront,
  GlobeHemisphereWest,
  Briefcase,
  MapPin,
  ChatCircle,
  Bell,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Suspense } from "react";
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

interface MainLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/home", label: "Home", icon: House },
  { href: "/community", label: "Community", icon: Users },
  { href: "/marketplace", label: "Market", icon: Storefront },
  { href: "/events", label: "Events", icon: GlobeHemisphereWest },
  { href: "/businesses", label: "Business", icon: Briefcase },
];

export function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
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
          const readReceiptDate = readReceiptStr ? new Date(readReceiptStr).getTime() : 0;
          const lastMsgDate = conv.last_message_timestamp ? new Date(conv.last_message_timestamp).getTime() : 0;
          const isReadByReceipt = readReceiptDate >= lastMsgDate && lastMsgDate > 0;

          if (isReadByReceipt) continue;

          if (conv.type === "marketplace") {
            const { data: msgs } = await supabase
              .from("chat_messages")
              .select("sender_id, metadata")
              .eq("chat_id", conv.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (msgs && msgs.sender_id !== user.id && !msgs.metadata?.isRead) unreadChatsCount++;
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
            )
              unreadChatsCount++;
          }
        }
        setUnreadMessagesCount(unreadChatsCount);
      } catch {
        // ignore
      }
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
      <div className="min-h-[100dvh] bg-[var(--c-bg)]" role="application">
        {/* ── Top Header ── */}
        {/* ── Top Header ── */}
        <Suspense fallback={null}>
          <header
            className={cn(
              "fixed top-0 left-0 right-0 z-50 flex items-center px-4 md:px-6 bg-card border-b border-border shadow-sm pt-[max(env(safe-area-inset-top),0px)] h-[calc(4rem+env(safe-area-inset-top))] md:h-[calc(84px+env(safe-area-inset-top))]",
              (isChatPage || isSubPage) ? "hidden lg:flex" : "flex"
            )}
          >
            <div className="w-full max-w-7xl mx-auto flex items-center gap-4">
              <Link href="/home" className="flex items-center gap-1.5 flex-shrink-0">
                <Image
                  src="/yrdly-logo.png"
                  alt="Yrdly"
                  width={39}
                  height={37}
                  className="h-8 w-8 object-contain md:h-[37px] md:w-[39px]"
                />
              </Link>

              <div className="hidden md:flex flex-1 justify-center max-w-xl">
                <button
                  type="button"
                  onClick={() => setShowSearch(true)}
                  className="w-full max-w-md h-10 rounded-full bg-background border border-border flex items-center gap-3 px-4 text-left hover:border-primary transition-colors"
                >
                  <MagnifyingGlass weight="bold" className="h-5 w-5 flex-shrink-0 text-[#767676]" />
                  <span
                    className="font-light italic text-xs text-[#767676] truncate"
                    style={{ fontFamily: '"Inter", sans-serif' }}
                  >
                    Search for events, items
                  </span>
                </button>
              </div>

              <div className="flex items-center gap-1 ml-auto md:gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden text-[#555555] hover:bg-[var(--c-bg)] rounded-full"
                  onClick={() => setShowSearch(true)}
                >
                  <MagnifyingGlass weight="bold" className="w-5 h-5" />
                </Button>

                <Link href="/map">
                  <Button variant="ghost" size="icon" className="text-[#555555] hover:bg-[var(--c-bg)] rounded-full">
                    <MapPin weight="bold" className="w-5 h-5" />
                  </Button>
                </Link>
                <Link href="/messages">
                  <Button variant="ghost" size="icon" className="relative text-[#555555] hover:bg-[var(--c-bg)] rounded-full">
                    <ChatCircle weight="fill" className="w-5 h-5" />
                    {unreadMessagesCount > 0 && (
                      <span
                        className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[0.5625rem] font-bold px-1"
                        style={{ background: "#388E3C", color: "#fff", border: "1.5px solid #fff" }}
                      >
                        {unreadMessagesCount > 9 ? "9+" : unreadMessagesCount}
                      </span>
                    )}
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative text-[#555555] hover:bg-[var(--c-bg)] rounded-full transition-colors"
                  onClick={() => setShowNotifications(!showNotifications)}
                >
                  <Bell weight="fill" className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span
                      className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[0.5625rem] font-bold px-1"
                      style={{ background: "#388E3C", color: "#fff", border: "1.5px solid #fff" }}
                    >
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full overflow-hidden p-0.5"
                  onClick={() => setShowProfile(!showProfile)}
                >
                  <Avatar className="w-8 h-8 md:w-9 md:h-9 rounded-full">
                    <AvatarImage src={profile?.avatar_url || ""} />
                    <AvatarFallback
                      style={{ background: "#388E3C", color: "#fff", fontFamily: "Inter, sans-serif", fontWeight: 700 }}
                    >
                      {profile?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </div>
            </div>
          </header>
        </Suspense>

        <div
          className={cn(
            "flex flex-col lg:flex-row min-h-[100dvh]",
            (isChatPage || isSubPage) ? "lg:pt-[84px]" : "pt-16 md:pt-[84px]",
            !isChatPage && "pb-[calc(64px+env(safe-area-inset-bottom)+2rem)] lg:pb-0"
          )}
        >
          {/* ── Desktop Left Nav ── */}
          <nav
            className="hidden lg:flex lg:flex-col lg:w-[200px] lg:flex-shrink-0 lg:fixed lg:left-0 lg:top-[84px] lg:bottom-0 lg:pt-3 lg:px-3 lg:pb-6 bg-card border-r border-border"
          >
            <div className="flex flex-col gap-0">
              {navItems.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href || (href !== "/home" && pathname.startsWith(href));
                return (
                  <Link key={href} href={href}>
                    <div
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-xl transition-colors",
                        isActive ? "bg-[#EBF5EB]" : "hover:bg-[var(--c-bg)]"
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-5 h-5 flex-shrink-0",
                          isActive ? "text-[#388E3C]" : "text-[#555555]"
                        )}
                        weight={isActive ? "fill" : "bold"}
                      />
                      <span
                        className={cn(
                          "text-[0.875rem] leading-snug",
                          isActive ? "text-[#388E3C] font-semibold" : "text-[#252629] font-normal"
                        )}
                        style={{ fontFamily: "Inter, sans-serif" }}
                      >
                        {label}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="mt-4 px-1">
              <CreatePostDialog
                createPost={createPost}
                open={postDialogOpen}
                onOpenChange={setPostDialogOpen}
              >
                <Button
                  className="w-full h-10 rounded-full text-white font-semibold text-[0.875rem]"
                  style={{ background: "#388E3C", fontFamily: "Inter, sans-serif" }}
                  onClick={() => setPostDialogOpen(true)}
                >
                  <Plus weight="bold" className="w-4 h-4 mr-1.5" />
                  Post
                </Button>
              </CreatePostDialog>
            </div>
          </nav>

          {/* ── Main Content ── */}
          <main
            className={cn(
              "flex-1 w-full min-w-0 lg:pl-[216px]",
              (isChatPage || isSubPage) ? "lg:pr-6 lg:py-4 h-[100dvh] lg:h-auto" : "px-3 sm:px-4 md:px-6 py-4"
            )}
          >
            <ErrorBoundary>
              {isChatPage ? (
                <div className="w-full h-full lg:h-[calc(100vh-120px)]">{children}</div>
              ) : (
                <div className="w-full max-w-[680px] mx-auto lg:max-w-[660px]">
                  {children}
                </div>
              )}
            </ErrorBoundary>
          </main>

          {showRightSidebar && <HomeRightSidebar />}
        </div>
      </div>

      {/* ── Mobile Bottom Nav ── */}
      {!isChatPage && (
        <Suspense fallback={null}>
          <nav
            className="lg:hidden fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-around px-2 bg-card border-t border-border shadow-[0_-2px_8px_rgba(0,0,0,0.08)]"
            style={{
              height: "calc(64px + max(env(safe-area-inset-bottom), 0px))",
              paddingBottom: "max(env(safe-area-inset-bottom), 0px)",
            }}
          >
            {navItems.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href || (href !== "/home" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center justify-center flex-1 h-full"
                >
                  <div className={cn(
                    "p-2 rounded-xl transition-all duration-300",
                    isActive ? "bg-[#EBF5EB]" : "bg-transparent"
                  )}>
                    <Icon
                      className={cn(
                        "w-5 h-5",
                        isActive ? "text-[#388E3C]" : "text-[#767676]"
                      )}
                      weight={isActive ? "fill" : "bold"}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-[0.5625rem] font-bold tracking-tight mt-1 transition-colors",
                      isActive ? "text-[#388E3C]" : "text-[#767676]"
                    )}
                    style={{ fontFamily: '"Inter", sans-serif' }}
                  >
                    {label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </Suspense>
      )}

      {showProfile && <ProfileDropdown onClose={() => setShowProfile(false)} />}
      <NotificationsDropdown isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
      <SearchDialog open={showSearch} onOpenChange={setShowSearch} />
    </>
  );
}
