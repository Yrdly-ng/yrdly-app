"use client";

import type { MouseEventHandler, ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { MagnifyingGlass, MapPin, ChatCircle, Bell } from "@phosphor-icons/react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface TopbarNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; weight?: "fill" | "regular"; className?: string }>;
}

interface TopbarProps {
  unreadMessages: number;
  unreadNotifications: number;
  onSearch: MouseEventHandler<HTMLButtonElement>;
  onNotifications: MouseEventHandler<HTMLButtonElement>;
  onProfile: MouseEventHandler<HTMLButtonElement>;
  profile?: {
    avatar_url?: string;
    name?: string;
  } | null;
  title?: string;
  navItems?: TopbarNavItem[];
  pathname?: string;
}

export function Topbar({
  unreadMessages,
  unreadNotifications,
  onSearch,
  onNotifications,
  onProfile,
  profile,
  title = "Home",
  navItems = [],
  pathname = "",
}: TopbarProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center px-4 md:px-6 bg-[var(--c-card)]/80 backdrop-blur-md border-b border-[var(--c-border)] h-[84px] shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
      <div className="w-full flex items-center gap-4">
        <Link href="/home" className="flex items-center gap-2.5 flex-shrink-0">
          <span className="flex items-center justify-center rounded-full bg-[var(--c-card2)] p-2 shadow-sm">
            <img src="/logo.png" alt="Yrdly" className="h-9 w-9 object-contain" />
          </span>
          <span
            className="hidden sm:block text-[1.2rem] font-extrabold text-[var(--c-text)] tracking-tight"
            style={{ fontFamily: "var(--font-raleway)" }}
          >
            Yrdly
          </span>
        </Link>

        {/* Desktop nav — replaces the old left sidebar */}
        {navItems.length > 0 && (
          <nav className="hidden lg:flex items-center gap-1 flex-shrink-0">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active =
                pathname === href ||
                (href !== "/home" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative flex items-center gap-2 px-3.5 py-2.5 rounded-full text-sm font-semibold transition-all duration-150 whitespace-nowrap",
                    active
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm"
                      : "text-[var(--c-text-muted)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                  )}
                >
                  <Icon size={20} weight={active ? "fill" : "regular"} className="flex-shrink-0" />
                  <span>{label}</span>
                  {active && (
                    <span className="absolute left-1/2 -bottom-[9px] -translate-x-1/2 h-[3px] w-6 rounded-full bg-[var(--primary)]" />
                  )}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="flex-1 flex justify-center px-2 min-w-[120px]">
          <button
            type="button"
            onClick={onSearch}
            className="group w-full max-w-xl h-12 flex items-center gap-2 pl-2 pr-3 text-left rounded-full border border-[var(--c-border)] bg-[var(--c-card2)] text-[var(--c-text-muted)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 focus-visible:border-[var(--primary)]/40 transition-all duration-150"
          >
            <span className="hidden sm:inline-flex items-center gap-1 flex-shrink-0 rounded-full bg-[var(--c-card)] border border-[var(--c-border)] px-3 py-1.5 text-[0.75rem] font-semibold text-[var(--c-text)]">
              All
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="opacity-60">
                <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <MagnifyingGlass weight="bold" className="h-4 w-4 text-current flex-shrink-0" />
            <span className="flex-1 font-normal text-sm truncate">
              Search for events, items, and people
            </span>
            <span className="hidden md:inline-flex items-center gap-0.5 flex-shrink-0 rounded-md bg-[var(--c-card)] border border-[var(--c-border)] px-1.5 py-1 text-[0.7rem] font-semibold text-[var(--c-text-muted)] group-hover:text-[var(--accent-foreground)]">
              ⌘K
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <div className="group/tip relative">
            <Link href="/map">
              <Button
                variant="ghost"
                size="icon"
                className="w-10 h-10 flex items-center justify-center text-[var(--c-text-muted)] border border-[var(--c-border)] bg-[var(--c-card2)] rounded-full hover:bg-[#F3F4F6] hover:text-[var(--foreground)] transition-all duration-150"
              >
                <MapPin weight="bold" className="w-5 h-5" />
              </Button>
            </Link>
            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap rounded-md bg-[var(--c-text)] px-2 py-1 text-[0.7rem] font-medium text-[var(--c-card)] opacity-0 scale-95 group-hover/tip:opacity-100 group-hover/tip:scale-100 transition-all duration-150 z-10">
              Location
            </span>
          </div>

          <div className="group/tip relative">
            <Link href="/messages">
              <Button
                variant="ghost"
                size="icon"
                className="relative w-10 h-10 flex items-center justify-center text-[var(--c-text-muted)] border border-[var(--c-border)] bg-[var(--c-card2)] rounded-full hover:bg-[#F3F4F6] hover:text-[var(--foreground)] transition-all duration-150"
              >
                <ChatCircle weight="bold" className="w-5 h-5" />
                {unreadMessages > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[#ED1111] text-white text-[0.65rem] font-bold leading-none border-2 border-[var(--c-card)]">
                    {unreadMessages > 9 ? "9+" : unreadMessages}
                  </span>
                )}
              </Button>
            </Link>
            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap rounded-md bg-[var(--c-text)] px-2 py-1 text-[0.7rem] font-medium text-[var(--c-card)] opacity-0 scale-95 group-hover/tip:opacity-100 group-hover/tip:scale-100 transition-all duration-150 z-10">
              Messages
            </span>
          </div>

          <div className="group/tip relative">
            <Button
              variant="ghost"
              size="icon"
              className="relative w-10 h-10 flex items-center justify-center text-[var(--c-text-muted)] border border-[var(--c-border)] bg-[var(--c-card2)] rounded-full hover:bg-[#F3F4F6] hover:text-[var(--foreground)] transition-all duration-150"
              onClick={onNotifications}
            >
              <Bell weight="bold" className="w-5 h-5" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[#ED1111] text-white text-[0.65rem] font-bold leading-none border-2 border-[var(--c-card)]">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </Button>
            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap rounded-md bg-[var(--c-text)] px-2 py-1 text-[0.7rem] font-medium text-[var(--c-card)] opacity-0 scale-95 group-hover/tip:opacity-100 group-hover/tip:scale-100 transition-all duration-150 z-10">
              Notifications
            </span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="w-10 h-10 rounded-full overflow-hidden p-0.5 ml-1 border border-[var(--c-border)] bg-[var(--c-card2)] shadow-sm"
            onClick={onProfile}
          >
            <Avatar className="w-10 h-10 rounded-full">
              <AvatarImage src={profile?.avatar_url || ""} />
              <AvatarFallback className="bg-[var(--primary)] text-white font-bold">
                {profile?.name?.charAt(0).toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
          </Button>
        </div>
      </div>
    </header>
  );
}