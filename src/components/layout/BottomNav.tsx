"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/shared/utils";

interface BottomNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; weight?: "fill" | "regular"; className?: string }>;
  matchPaths?: string[];
}

interface BottomNavProps {
  navItems: BottomNavItem[];
  pathname: string;
  onCreateMenu?: () => void;
  unreadMessages?: number;
}

export function BottomNav({ navItems, pathname, onCreateMenu, unreadMessages = 0 }: BottomNavProps) {
  const isActive = (item: BottomNavItem) =>
    pathname === item.href ||
    (item.href !== "/home" && pathname.startsWith(item.href)) ||
    item.matchPaths?.some((p) => pathname === p || pathname.startsWith(p + "/"));

  const renderItem = (item: BottomNavItem) => {
    const active = isActive(item);
    const { href, label, icon: Icon } = item;
    const isMessages = href === "/messages";

    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex min-h-[68px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 py-2 text-[11px] font-semibold leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
          active ? "text-[var(--primary)]" : "text-[var(--c-text-muted)]"
        )}
      >
        <div className="relative">
          <Icon size={24} weight={active ? "fill" : "regular"} className="flex-shrink-0" />
          {isMessages && unreadMessages > 0 && (
            <span className="absolute -top-1 -right-2.5 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-[#82DB7E] text-black text-[0.6rem] font-extrabold leading-none shadow-sm">
              {unreadMessages > 9 ? "9+" : unreadMessages}
            </span>
          )}
        </div>
        <span className="max-w-full truncate text-center">{label}</span>
      </Link>
    );
  };

  // Center + FAB sits between the 2nd and 3rd tab (mobile pattern)
  const leftItems = navItems.slice(0, 2);
  const rightItems = navItems.slice(2);

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden items-center justify-around bg-[var(--c-card)]/95 backdrop-blur-lg border-t border-[var(--c-border)] pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgba(0,0,0,0.10)] [transform:translateZ(0)] [will-change:transform]"
      style={{
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden',
        WebkitTransform: 'translateZ(0)',
        transform: 'translateZ(0)',
      }}
    >
      {leftItems.map(renderItem)}

      {onCreateMenu && (
        <button
          onClick={onCreateMenu}
          aria-label="Create a post, listing, event or safety alert"
          className="relative -translate-y-2 flex h-14 w-14 items-center justify-center rounded-[19px] border-4 border-[var(--c-card)] bg-[#82DB7E] text-black font-extrabold shadow-lg shadow-black/20 transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Plus size={26} weight="bold" />
        </button>
      )}

      {rightItems.map(renderItem)}
    </nav>
  );
}
