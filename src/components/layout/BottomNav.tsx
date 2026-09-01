"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

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
}

export function BottomNav({ navItems, pathname, onCreateMenu }: BottomNavProps) {
  const isActive = (item: BottomNavItem) =>
    pathname === item.href ||
    (item.href !== "/home" && pathname.startsWith(item.href)) ||
    item.matchPaths?.some((p) => pathname === p || pathname.startsWith(p + "/"));

  const renderItem = (item: BottomNavItem) => {
    const active = isActive(item);
    const { href, label, icon: Icon } = item;
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[0.65rem] font-semibold transition-colors duration-150",
          active ? "text-[var(--primary)]" : "text-[var(--c-text-muted)]"
        )}
      >
        <Icon size={22} weight={active ? "fill" : "regular"} className="flex-shrink-0" />
        <span>{label}</span>
      </Link>
    );
  };

  // Center + FAB sits between the 2nd and 3rd tab (mobile pattern)
  const leftItems = navItems.slice(0, 2);
  const rightItems = navItems.slice(2);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden items-center justify-around bg-[var(--c-card)]/95 backdrop-blur-md border-t border-[var(--c-border)] pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgba(0,0,0,0.08)] [transform:translateZ(0)] [will-change:transform] animate-fade-in motion-snappy"
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
          aria-label="Create"
          className="relative -translate-y-3 flex items-center justify-center w-12 h-12 rounded-full bg-[var(--primary)] text-white shadow-lg shadow-black/20 transition-transform duration-150 active:scale-90"
        >
          <Plus size={26} weight="bold" />
        </button>
      )}

      {rightItems.map(renderItem)}
    </nav>
  );
}
