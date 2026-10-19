"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import {
  initializeWebAnalytics,
  setWebAnalyticsUser,
  trackWebPage,
} from "@/lib/telemetry/analytics";
import { setWebUser } from "@/lib/telemetry/sentry";

export function TelemetryHandler() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const id = user?.id ?? null;

  useEffect(() => {
    // Clear any old identity immediately while an account transition resolves.
    setWebUser(loading ? null : id);
    setWebAnalyticsUser(loading ? null : id);
    if (loading) return;
    let cancelled = false;
    void initializeWebAnalytics().then(() => {
      if (!cancelled && pathname) void trackWebPage(pathname);
    });
    return () => {
      cancelled = true;
    };
  }, [id, loading, pathname]);

  return null;
}
