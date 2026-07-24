"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface BottomNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; weight?: "fill" | "regular"; className?: string }>;
}

interface BottomNavProps {
  navItems: BottomNavItem[];
  pathname: string;
}

export function BottomNav({ navItems, pathname }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden items-center justify-around bg-[var(--c-card)]/95 backdrop-blur-md border-t border-[var(--c-border)] pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgba(0,0,0,0.08)]">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href || (href !== "/home" && pathname.startsWith(href));
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
      })}
    </nav>
  );
}