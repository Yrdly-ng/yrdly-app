"use client";

import type { MouseEventHandler, ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { MapPin, Bell } from "@phosphor-icons/react";
import Link from "next/link";
import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { LocationChip } from "@/components/LocationChip";

interface TopbarNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; weight?: "fill" | "regular"; className?: string }>;
  matchPaths?: string[];
}

interface TopbarProps {
  unreadMessages?: number;
  unreadNotifications: number;
  onSearch?: MouseEventHandler<HTMLButtonElement>;
  onNotifications: MouseEventHandler<HTMLButtonElement>;
  onProfile: MouseEventHandler<HTMLButtonElement>;
  onCreate?: () => void;
  profile?: {
    avatar_url?: string;
    name?: string;
  } | null;
  title?: string;
  navItems?: TopbarNavItem[];
  pathname?: string;
}

export function Topbar({
  unreadNotifications,
  onNotifications,
  onProfile,
  profile,
  navItems = [],
  pathname = "",
}: TopbarProps) {
  return (
    <header 
      className="fixed top-0 left-0 right-0 z-50 flex items-center px-4 md:px-6 bg-[var(--c-card)]/80 backdrop-blur-md border-b border-[var(--c-border)] h-[64px] md:h-[84px] shadow-[0_8px_32px_rgba(0,0,0,0.08)] [transform:translateZ(0)] [will-change:transform]"
      style={{
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden',
        WebkitTransform: 'translateZ(0)',
        transform: 'translateZ(0)',
      }}
    >
      <div className="w-full flex items-center gap-3 md:gap-4">
        <Link href="/home" className="flex items-center gap-2 flex-shrink-0">
          <span className="font-yrdly-display font-black text-2xl tracking-tight text-[#82DB7E]">
            YRDLY
          </span>
        </Link>

        <div className="flex-shrink-0">
          <LocationChip />
        </div>

        {/* Desktop nav — replaces the old left sidebar */}
        {navItems.length > 0 && (
          <nav className="hidden lg:flex items-center gap-1 flex-shrink-0">
            {navItems.map(({ href, label, icon: Icon, matchPaths }) => {
              const active =
                pathname === href ||
                (href !== "/home" && pathname.startsWith(href)) ||
                matchPaths?.some((p) => pathname === p || pathname.startsWith(p + "/"));
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

        <div className="flex flex-1" />

        <div className="flex items-center gap-1.5 md:gap-2 ml-auto flex-shrink-0">
          <div className="group/tip relative">
            <Link href="/map">
              <Button
                variant="ghost"
                size="icon"
                className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center text-[var(--c-text-muted)] border border-[var(--c-border)] bg-[var(--c-card2)] rounded-full hover:bg-[#F3F4F6] hover:text-[var(--foreground)] transition-all duration-150"
              >
                <MapPin weight="bold" className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </Link>
            <span className="hidden md:block pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap rounded-md bg-[var(--c-text)] px-2 py-1 text-[0.7rem] font-medium text-[var(--c-card)] opacity-0 scale-95 group-hover/tip:opacity-100 group-hover/tip:scale-100 transition-all duration-150 z-10">
              Location
            </span>
          </div>

          <div className="group/tip relative">
            <Button
              variant="ghost"
              size="icon"
              className="relative w-9 h-9 md:w-10 md:h-10 flex items-center justify-center text-[var(--c-text-muted)] border border-[var(--c-border)] bg-[var(--c-card2)] rounded-full hover:bg-[#F3F4F6] hover:text-[var(--foreground)] transition-all duration-150"
              onClick={onNotifications}
            >
              <Bell weight="bold" className="w-4 h-4 md:w-5 md:h-5" />
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
            className="flex w-9 h-9 md:w-10 md:h-10 rounded-full overflow-hidden p-0.5 ml-1 border border-[var(--c-border)] bg-[var(--c-card2)] shadow-sm"
            onClick={onProfile}
          >
            <Avatar className="w-full h-full rounded-full">
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