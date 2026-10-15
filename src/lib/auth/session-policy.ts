"use client";
import { supabase } from "../supabase/supabase";
export async function checkActiveSession(
  activate = false,
): Promise<boolean | null> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  const before = (await supabase.auth.getSession()).data.session?.access_token;
  if (!before) return null;
  const { data, error } = await supabase
    .rpc(activate ? "activate_latest_session" : "is_current_session_active")
    .abortSignal(AbortSignal.timeout(10000));
  if (before !== (await supabase.auth.getSession()).data.session?.access_token)
    return null;
  return error ? null : data === true;
}
let ending = false;
export async function endRevokedSession() {
  if (ending) return;
  ending = true;
  try {
    await supabase.removeAllChannels();
    await supabase.auth.signOut({ scope: "local" });
    window.alert(
      "Your account was signed in on another device. Please log in again to continue.",
    );
  } finally {
    ending = false;
  }
}
export function watchSession() {
  let busy = false,
    disposed = false;
  const check = async () => {
    if (busy || disposed || document.hidden) return;
    busy = true;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session && (await checkActiveSession()) === false && !disposed)
        await endRevokedSession();
    } catch {
      // Retry on the next foreground/online check without treating a network
      // failure as a revoked session.
    } finally {
      busy = false;
    }
  };
  const onVisible = () => {
    void check();
  };
  window.addEventListener("online", onVisible);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(onVisible, 20000);
  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener("online", onVisible);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
