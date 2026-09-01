"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { AlertService, type Alert, type AlertSeverity } from "@/lib/alert-service";
import { AlertBanner } from "@/components/AlertBanner";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const FONT = "var(--font-work-sans)";

type SeverityFilter = "all" | AlertSeverity;

const FILTERS: { key: SeverityFilter; label: string; color: string; bg: string }[] = [
  { key: "all", label: "All", color: "var(--foreground)", bg: "var(--c-card2)" },
  { key: "urgent", label: "Urgent", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  { key: "caution", label: "Caution", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  { key: "information", label: "Info", color: "#3b82f6", bg: "rgba(59,130,246,0.10)" },
];

export function AlertsScreen() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<SeverityFilter>("all");
  const [isAdmin, setIsAdmin] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    const fetched = await AlertService.getActiveAlerts();
    setAlerts(fetched);
  }, []);

  useEffect(() => {
    fetchAlerts().then(() => setLoading(false));
  }, [fetchAlerts]);

  useEffect(() => {
    if (!user) return;
    AlertService.isUserAdmin(user.id).then(setIsAdmin);
  }, [user]);

  const filtered = useMemo(
    () =>
      activeFilter === "all"
        ? alerts
        : alerts.filter((a) => a.severity === activeFilter),
    [alerts, activeFilter]
  );

  const sections = useMemo(() => {
    const active = filtered.filter((a) => a.status !== "resolved");
    const resolved = filtered.filter((a) => a.status === "resolved");
    const result: { title: string; data: Alert[] }[] = [];
    if (active.length > 0) result.push({ title: `ACTIVE · ${active.length}`, data: active });
    if (resolved.length > 0)
      result.push({ title: `RESOLVED · ${resolved.length}`, data: resolved });
    return result;
  }, [filtered]);

  const handleResolve = async (alert: Alert) => {
    setResolvingId(alert.id);
    const { error } = await AlertService.resolveAlert(alert.id);
    setResolvingId(null);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not resolve alert. Admins only.",
      });
      return;
    }

    toast({ title: "Alert resolved" });
    fetchAlerts();
  };

  const activeCount = alerts.filter((a) => a.status !== "resolved").length;

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pt-1 pb-4">
        <div className="min-w-0">
          <h1 className="text-3xl text-foreground leading-tight" style={{ fontFamily: FONT, fontWeight: 700 }}>
            Safety Alerts
          </h1>
          <p className="text-sm truncate" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
            What&apos;s happening in your neighborhood
          </p>
        </div>
        <span
          className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[0.6875rem] font-bold"
          style={{
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.25)",
            color: "#ef4444",
            fontFamily: FONT,
          }}
        >
          {activeCount} ACTIVE
        </span>
      </div>

      {/* Severity filter chips */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {FILTERS.map(({ key, label, color, bg }) => {
          const active = key === activeFilter;
          return (
            <button
              key={key}
              onClick={() => setActiveFilter(key)}
              className={cn(
                "px-4 py-1.5 rounded-full text-[0.8125rem] font-semibold whitespace-nowrap transition-all duration-150 active:scale-95",
                !active && "border border-[var(--c-border)]"
              )}
              style={{
                background: active ? bg : "transparent",
                color: active ? color : "var(--c-text-muted)",
                fontFamily: FONT,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" style={{ background: "var(--c-card)" }} />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center px-6">
          <ShieldCheck size={48} weight="light" className="text-[var(--c-text-muted)] mb-4" />
          <p className="text-base font-medium" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
            {activeFilter === "all"
              ? "There are no active alerts in your area."
              : `No ${activeFilter} alerts right now.`}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map((section) => (
            <div key={section.title}>
              <p
                className="text-[0.6875rem] font-bold tracking-[0.08em] mb-2.5"
                style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
              >
                {section.title}
              </p>
              <div className="space-y-3">
                {section.data.map((alert) => (
                  <AlertBanner
                    key={`${alert.source_table}-${alert.id}`}
                    alert={alert}
                    onResolve={
                      isAdmin && alert.source_table === "alerts"
                        ? () => handleResolve(alert)
                        : undefined
                    }
                    resolving={resolvingId === alert.id}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
