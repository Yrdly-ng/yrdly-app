"use client";

import Link from "next/link";
import { Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function Sidebar({ navItems, pathname, onCreatePost }) {
  return (
    <aside className="h-screen w-20 bg-white border-r border-gray-100 flex flex-col justify-between fixed left-0 top-0 pt-[84px] shadow-[1px_0_12px_rgba(0,0,0,0.03)]">
      <div className="flex flex-col items-center mt-6 space-y-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            (href !== "/home" && pathname.startsWith(href));

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center w-16 py-2.5 rounded-2xl transition-all duration-150",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-gray-500 hover:bg-gray-50 hover:text-primary"
              )}
            >
              <Icon
                size={22}
                weight={active ? "fill" : "bold"}
                className={cn(active ? "text-primary" : "text-gray-500")}
              />
              <span className={cn("text-[11px] mt-1 font-medium", active ? "text-primary" : "text-gray-500")}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col items-center mb-6 space-y-4">
        <button
          onClick={onCreatePost}
          className="flex items-center justify-center w-12 h-12 rounded-full bg-primary text-white shadow-[0_4px_14px_rgba(56,142,60,0.35)] hover:brightness-105 active:scale-95 transition-all duration-150"
          aria-label="Create post"
        >
          <Plus size={22} weight="bold" />
        </button>
      </div>
    </aside>
  );
}
