"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { reportGoogleAdsSignup } from "@/lib/attribution/google-ads";

/**
 * The server adds new_signup=google|apple to the redirect ONLY after
 * a freshly created OAuth identity and successful profile insertion.
 * Verify the account's creation time again before reporting Ads conversion.
 */
export function SignupConversionHandler() {
  useEffect(() => {
    if (window.location.hostname !== "app.yrdly.ng") return;
    const url = new URL(window.location.href);
    const method = url.searchParams.get("new_signup");
    if (method !== "google" && method !== "apple") return;
    // Remove the one-time routing marker to prevent accidental reuse.
    url.searchParams.delete("new_signup");
    window.history.replaceState(window.history.state, "", url.toString());
    void (async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session?.user?.id) return;
      if (session.user.app_metadata?.provider !== method) return;
      const ago = Date.now() - Date.parse(session.user.created_at);
      if (!Number.isFinite(ago) || ago < -60_000 || ago > 600_000) return;
      reportGoogleAdsSignup(session.user.id);
    })();
  }, []);
  return null;
}
