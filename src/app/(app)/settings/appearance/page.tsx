"use client";

import Link from "next/link";
import { ArrowLeft, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";

const options = [
  {
    value: "light" as const,
    label: "Light",
    description: "Clean white interface, great for daytime use.",
    icon: Sun,
  },
  {
    value: "dark" as const,
    label: "Dark",
    description: "Easy on the eyes in low-light environments.",
    icon: Moon,
  },
  {
    value: "system" as const,
    label: "System",
    description: "Follows your device's display settings automatically.",
    icon: Monitor,
  },
];

export default function AppearancePage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="pt-4 pb-20 px-4 max-w-2xl mx-auto space-y-6">
      <Link
        href="/settings"
        className="flex items-center gap-2 text-sm font-bold text-primary"
        style={{ fontFamily: "var(--font-work-sans)" }}
      >
        <ArrowLeft className="h-4 w-4" /> Back to Settings
      </Link>

      <h1
        className="text-2xl font-extrabold text-foreground"
        style={{ fontFamily: "var(--font-jersey25)" }}
      >
        Appearance
      </h1>

      <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-work-sans)" }}>
        Choose how Yrdly looks for you.
      </p>

      <div className="flex flex-col gap-3">
        {options.map(({ value, label, description, icon: Icon }) => {
          const isActive = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={cn(
                "flex items-center gap-4 p-5 rounded-[11px] border-2 text-left transition-all w-full",
                isActive
                  ? "border-primary bg-accent"
                  : "border-border bg-card hover:border-primary/40"
              )}
            >
              <div
                className={cn(
                  "w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0",
                  isActive ? "bg-primary" : "bg-muted"
                )}
              >
                <Icon
                  className="w-5 h-5"
                  style={{ color: isActive ? "#fff" : "#767676" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn("font-semibold text-sm", isActive ? "text-primary" : "text-foreground")}
                  style={{ fontFamily: "var(--font-work-sans)" }}
                >
                  {label}
                </p>
                <p
                  className="text-[0.6875rem] mt-0.5 text-muted-foreground"
                  style={{ fontFamily: "var(--font-work-sans)" }}
                >
                  {description}
                </p>
              </div>
              {isActive && (
                <span
                  className="ml-auto text-[0.625rem] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{ background: "hsl(var(--primary))", color: "#fff", fontFamily: "var(--font-work-sans)" }}
                >
                  Active
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
