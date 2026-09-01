"use client";

import { Warning, MapPin, ArrowClockwise } from "@phosphor-icons/react";
import type { Alert, AlertSeverity } from "@/lib/alert-service";
import { cn } from "@/lib/utils";

const FONT = "var(--font-work-sans)";

const SEVERITY_STYLES: Record<
  AlertSeverity,
  { bg: string; border: string; text: string; icon: string }
> = {
  urgent: {
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.25)",
    text: "#ef4444",
    icon: "#ef4444",
  },
  caution: {
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.25)",
    text: "#f59e0b",
    icon: "#f59e0b",
  },
  information: {
    bg: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.25)",
    text: "#3b82f6",
    icon: "#3b82f6",
  },
};

const TYPE_LABELS: Record<string, string> = {
  safety: "SAFETY ALERT",
  amber: "AMBER ALERT",
  info: "COMMUNITY INFO",
};

interface AlertBannerProps {
  alert: Alert;
  onPress?: () => void;
  onResolve?: () => void;
  resolving?: boolean;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function AlertBanner({ alert, onPress, onResolve, resolving }: AlertBannerProps) {
  const isResolved = alert.status === "resolved";
  const c = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.information;

  const content = (
    <div
      className={cn(
        "relative flex items-start gap-3 p-4 rounded-2xl transition-all duration-150",
        onPress && !isResolved && "hover:shadow-md active:scale-[0.99] cursor-pointer"
      )}
      style={{
        background: isResolved ? "var(--c-card2)" : c.bg,
        border: isResolved ? "1px solid var(--c-border)" : `1px solid ${c.border}`,
        borderLeft: isResolved ? "3px solid var(--c-border)" : `3px solid ${c.icon}`,
        opacity: isResolved ? 0.65 : 1,
        fontFamily: FONT,
      }}
      onClick={onPress && !isResolved ? onPress : undefined}
    >
      <Warning
        size={18}
        weight="fill"
        style={{ color: isResolved ? "var(--c-text-muted)" : c.icon, marginTop: 2, flexShrink: 0 }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span
            className="text-[0.6875rem] font-bold tracking-wide uppercase"
            style={{ color: isResolved ? "var(--c-text-muted)" : c.text }}
          >
            {TYPE_LABELS[alert.type] || alert.type || "ALERT"}
          </span>
          <span className="text-[0.625rem]" style={{ color: "var(--c-text-muted)" }}>
            · {timeAgo(alert.created_at)}
          </span>
          {isResolved && (
            <span
              className="px-2 py-0.5 rounded-md text-[0.625rem] font-bold"
              style={{
                background: "rgba(56,142,60,0.12)",
                border: "1px solid rgba(56,142,60,0.25)",
                color: "hsl(var(--primary))",
              }}
            >
              RESOLVED
            </span>
          )}
        </div>

        <p className="text-[0.9375rem] font-bold text-foreground leading-snug mb-1">
          {alert.title}
        </p>

        <p
          className="text-[0.8125rem] text-[var(--c-text-muted)] leading-snug mb-1.5 line-clamp-3"
        >
          {alert.description}
        </p>

        <div className="flex items-center gap-2 text-[0.75rem]" style={{ color: "var(--c-text-muted)" }}>
          <MapPin size={12} weight="bold" className="flex-shrink-0" />
          <span className="truncate">{alert.area || "Unknown location"}</span>
        </div>

        {alert.action && !isResolved && (
          <div
            className="mt-2 px-3 py-2 rounded-xl text-[0.75rem]"
            style={{ background: "var(--c-card)", border: "0.5px solid var(--c-border)" }}
          >
            <span className="font-bold" style={{ color: c.text }}>
              What to do:{" "}
            </span>
            <span className="text-foreground">{alert.action}</span>
          </div>
        )}
      </div>

      {onResolve && !isResolved && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onResolve();
          }}
          disabled={resolving}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[0.6875rem] font-bold transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{
            background: "rgba(56,142,60,0.12)",
            border: "1px solid rgba(56,142,60,0.3)",
            color: "hsl(var(--primary))",
          }}
        >
          <ArrowClockwise size={12} weight="bold" className={resolving ? "animate-spin" : ""} />
          Resolve
        </button>
      )}
    </div>
  );

  return content;
}
