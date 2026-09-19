"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { SETTINGS_GROUPS } from "@/components/settings/settings-menu";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile } = useAuth();
  const isAdmin = !!((profile as any)?.is_admin || (profile as any)?.role === "admin");
  const isIndexPage = pathname === "/settings";

  return (
    <div className="w-full lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8 pt-4 items-start font-yrdly-body">
      {/* Master Menu (Desktop only) */}
      <aside className="hidden lg:block sticky top-4 space-y-6 select-none">
        <div className="flex items-center gap-2 px-1 pb-1 border-b border-[var(--yrdly-glass-border)]">
          <SettingsIcon className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground font-yrdly-display">Settings</h2>
        </div>

        <nav className="space-y-5">
          {SETTINGS_GROUPS.map((group) => {
            if (group.adminOnly && !isAdmin) return null;
            return (
              <div key={group.title} className="space-y-1.5">
                <h3 className="text-[10px] font-bold uppercase tracking-wider px-2 text-[var(--yrdly-label)] font-yrdly-display">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    if (!item.href) return null;
                    const isActive =
                      pathname === item.href ||
                      (item.href !== "/settings" && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold font-yrdly-body transition-all ${
                          isActive
                            ? "bg-primary text-black shadow-sm font-bold"
                            : "text-foreground/90 hover:bg-white/5 hover:text-foreground"
                        }`}
                      >
                        <div className={isActive ? "text-black" : ""}>
                          <Icon className={`w-4 h-4 ${item.danger ? "text-red-500" : "text-primary"}`} />
                        </div>
                        <span className="flex-1 truncate">{item.label}</span>
                        <ChevronRight className={`w-3.5 h-3.5 ${isActive ? "text-black" : "text-[var(--yrdly-label)]"}`} />
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Pane ({children} rendered EXACTLY ONCE) */}
      <main className="min-w-0">
        {isIndexPage && (
          <div className="hidden lg:flex flex-col items-center justify-center p-12 border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-md rounded-[20px] min-h-[450px] text-center space-y-3">
            <SettingsIcon className="w-10 h-10 text-[var(--yrdly-label)] opacity-50" />
            <h3 className="text-base font-bold text-foreground font-yrdly-display">Select a setting</h3>
            <p className="text-xs text-[var(--yrdly-label)] max-w-xs font-yrdly-body">
              Choose a setting option from the left menu to view and update your preference.
            </p>
          </div>
        )}
        <div className={isIndexPage ? "lg:hidden" : ""}>
          {children}
        </div>
      </main>
    </div>
  );
}
