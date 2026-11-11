"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import {
  initializeWebAnalytics,
  setWebAnalyticsUser,
  trackWebPage,
  trackWebActivationEvent,
} from "@/lib/telemetry/analytics";
import { setWebUser } from "@/lib/telemetry/sentry";

export function TelemetryHandler() {
  const pathname = usePathname();
  const visitedUser = useRef<string | null>(null);
  const homeReachedUser = useRef<string | null>(null);
  const { user, profile, loading } = useAuth();
  const id = user?.id ?? null;
  const selectedHomeState = profile?.id === id ? profile?.home_state : null;

  useEffect(() => {
    // Clear any old identity immediately while an account transition resolves.
    setWebUser(loading ? null : id);
    setWebAnalyticsUser(loading ? null : id, loading ? null : selectedHomeState);
    if (!id) { visitedUser.current = null; homeReachedUser.current = null; }
    if (loading) return;
    let cancelled = false;
    void initializeWebAnalytics().then(() => {
      if (cancelled) return;
      if (pathname) void trackWebPage(pathname);
      const ready = !!id && profile?.id === id && profile?.profile_completed;
      if (!ready) return;
      if (visitedUser.current !== id) {
        visitedUser.current = id;
        void trackWebActivationEvent("onboarding_active_visit");
      }
      if (pathname === "/home" && homeReachedUser.current !== id) {
        homeReachedUser.current = id;
        void trackWebActivationEvent("onboarding_home_reached");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, loading, pathname, selectedHomeState, profile?.profile_completed, profile?.id]);

  return null;
}
