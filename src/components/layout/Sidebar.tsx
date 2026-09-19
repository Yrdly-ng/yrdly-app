"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import {
  House,
  Compass,
  ChatCircle,
  User,
  Gear,
  MagnifyingGlass,
  Bell,
  Plus,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LocationChip } from "@/components/LocationChip";
import { cn } from "@/lib/utils";

interface SidebarNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; weight?: "fill" | "regular"; className?: string }>;
  matchPaths?: string[];
}

interface SidebarProps {
  unreadMessages?: number;
  unreadNotifications: number;
  onSearch: () => void;
  onNotifications: () => void;
  onProfile: () => void;
  onCreate: () => void;
  profile?: {
    avatar_url?: string;
    name?: string;
  } | null;
  navItems: SidebarNavItem[];
  pathname: string;
}

export function Sidebar({
  unreadMessages = 0,
  unreadNotifications,
  onSearch,
  onNotifications,
  onProfile,
  onCreate,
  profile,
  navItems,
  pathname,
}: SidebarProps) {
  const isSettingsActive = pathname.startsWith("/settings");

  return (
    <aside className="fixed top-0 left-0 bottom-0 z-40 hidden lg:flex w-64 flex-col border-r border-[var(--c-border)] bg-[var(--c-card)] p-4 font-yrdly-body select-none">
      {/* Brand & Location Chip */}
      <div className="flex items-center justify-between pb-6 pt-1">
        <Link href="/home" className="flex items-center gap-2">
          <span className="font-yrdly-display font-black text-2xl tracking-tight text-[#82DB7E]">
            YRDLY
          </span>
        </Link>
        <LocationChip />
      </div>

      {/* Primary Nav Links */}
      <nav className="flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon, matchPaths }) => {
          const active =
            pathname === href ||
            (href !== "/home" && pathname.startsWith(href)) ||
            matchPaths?.some((p) => pathname === p || pathname.startsWith(p + "/"));
          const isMessages = href === "/messages";

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center justify-between px-3.5 py-3 rounded-2xl text-sm font-semibold transition-all duration-150",
                active
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm font-bold"
                  : "text-[var(--c-text-muted)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon size={22} weight={active ? "fill" : "regular"} className="flex-shrink-0" />
                <span>{label}</span>
              </div>
              {isMessages && unreadMessages > 0 && (
                <span className="min-w-[18px] h-[18px] px-1.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[0.65rem] font-bold">
                  {unreadMessages > 9 ? "9+" : unreadMessages}
                </span>
              )}
            </Link>
          );
        })}

        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3.5 py-3 rounded-2xl text-sm font-semibold transition-all duration-150",
            isSettingsActive
              ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm font-bold"
              : "text-[var(--c-text-muted)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          )}
        >
          <Gear size={22} weight={isSettingsActive ? "fill" : "regular"} className="flex-shrink-0" />
          <span>Settings</span>
        </Link>
      </nav>

      {/* "+ Create" Action Button */}
      <div className="mt-4 px-1">
        <button
          onClick={onCreate}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-[#82DB7E] text-black font-extrabold text-sm shadow-md hover:brightness-105 active:scale-[0.98] transition-all duration-150"
        >
          <Plus size={20} weight="bold" />
          <span>Create</span>
        </button>
      </div>

      <div className="flex-1" />

      {/* Bottom Controls Bar */}
      <div className="pt-4 border-t border-[var(--c-border)] flex items-center justify-between px-1">
        <button
          onClick={onSearch}
          className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--c-text-muted)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] transition-colors"
          title="Search"
          aria-label="Search"
        >
          <MagnifyingGlass size={22} weight="bold" />
        </button>

        <button
          onClick={onNotifications}
          className="relative w-10 h-10 rounded-full flex items-center justify-center text-[var(--c-text-muted)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] transition-colors"
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell size={22} weight="bold" />
          {unreadNotifications > 0 && (
            <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[#ED1111] text-white text-[0.65rem] font-bold leading-none border-2 border-[var(--c-card)]">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </button>

        <button
          onClick={onProfile}
          className="w-10 h-10 rounded-full p-0.5 overflow-hidden border border-[var(--c-border)] hover:ring-2 hover:ring-primary/40 transition-all"
          title="Profile menu"
          aria-label="Profile menu"
        >
          <Avatar className="w-full h-full rounded-full">
            <AvatarImage src={profile?.avatar_url || ""} />
            <AvatarFallback className="bg-[var(--primary)] text-white font-bold text-xs">
              {profile?.name?.charAt(0).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
        </button>
      </div>
    </aside>
  );
}
