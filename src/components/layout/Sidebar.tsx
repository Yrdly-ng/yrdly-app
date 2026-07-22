"use client";

import Link from "next/link";
import { Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function Sidebar({ navItems, pathname, onCreatePost }) {
  return (
    <aside className="h-screen w-20 bg-white border-r border-gray-200 flex flex-col justify-between fixed left-0 top-0 pt-[84px]">
      <div className="flex flex-col items-center mt-6 space-y-6">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            (href !== "/home" && pathname.startsWith(href));

          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center text-gray-600 hover:text-blue-600"
            >
              <Icon
                size={22}
                weight={active ? "fill" : "bold"}
                className={cn(active ? "text-blue-600" : "text-gray-600")}
              />
              <span className="text-xs mt-1">{label}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col items-center mb-6 space-y-4">
        <button
          onClick={onCreatePost}
          className="flex flex-col items-center text-gray-600 hover:text-blue-600"
        >
          <Plus size={22} weight="bold" />
          <span className="text-xs mt-1">Post</span>
        </button>
      </div>
    </aside>
  );
}
