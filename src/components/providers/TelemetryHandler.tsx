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
  const { user, profile, loading } = useAuth();
  const id = user?.id ?? null;
  const selectedHomeState = profile?.id === id ? profile?.home_state : null;

  useEffect(() => {
    // Clear any old identity immediately while an account transition resolves.
    setWebUser(loading ? null : id);
    setWebAnalyticsUser(loading ? null : id, loading ? null : selectedHomeState);
    if (loading) return;
    let cancelled = false;
    void initializeWebAnalytics().then(() => {
      if (!cancelled && pathname) void trackWebPage(pathname);
    });
    return () => {
      cancelled = true;
    };
  }, [id, loading, pathname, selectedHomeState]);

  return null;
}
