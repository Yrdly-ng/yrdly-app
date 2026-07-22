"use client";

import Link from "next/link";
import { Gear } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Sidebar({ navItems, pathname, profile, onSettings }) {
  return (
    <aside className="hidden lg:flex h-screen w-64 bg-white border-r border-gray-100 flex-col justify-between fixed left-0 top-0 pt-[84px] z-40">
      <nav className="flex flex-col mt-4 px-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            (href !== "/home" && pathname.startsWith(href));

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 pl-4 pr-3 py-3 rounded-r-xl border-l-[3px] transition-all duration-150",
                active
                  ? "border-blue-600 bg-blue-50 text-blue-600"
                  : "border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              )}
            >
              <Icon
                size={22}
                weight={active ? "fill" : "regular"}
                className={active ? "text-blue-600" : "text-gray-500"}
              />
              <span
                className={cn(
                  "text-[15px] font-semibold",
                  active ? "text-blue-600" : "text-gray-700"
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-3 px-6 py-5 border-t border-gray-100">
        <button
          onClick={onSettings}
          className="flex items-center justify-center w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          aria-label="Settings"
        >
          <Gear size={20} weight="bold" />
        </button>
        <Avatar className="w-9 h-9">
          <AvatarImage src={profile?.avatar_url || ""} />
          <AvatarFallback className="bg-primary text-white text-sm font-bold">
            {profile?.name?.charAt(0).toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
      </div>
    </aside>
  );
}
