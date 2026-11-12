"use client";

import { supabase } from "@/lib/supabase/supabase";

export type WebPushSetupResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "ios_install_required"
        | "permission_required"
        | "permission_denied"
        | "vapid_unavailable"
        | "subscription_failed";
    };

export function webPushAvailability(): WebPushSetupResult {
  if (typeof window === "undefined" || !("Notification" in window) ||
      !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  // iPhone/iPad Safari supports Web Push only for installed Home Screen apps.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (isIOS && !installed) return { ok: false, reason: "ios_install_required" };
  return { ok: true };
}

export function webPushErrorMessage(result: WebPushSetupResult): string {
  if (result.ok) return "Browser notifications are enabled.";
  switch (result.reason) {
    case "ios_install_required":
      return "On iPhone or iPad, add YRDLY to your Home Screen, open the installed app, then enable notifications.";
    case "unsupported":
      return "This browser doesn't support web push notifications.";
    case "permission_denied":
      return "Notifications are blocked. Enable them in your browser or device settings, then retry.";
    case "permission_required":
      return "Tap Enable Notifications to allow notifications for this browser.";
    case "vapid_unavailable":
      return "Browser push configuration is temporarily unavailable. Please try again later.";
    default:
      return "This browser couldn't register for notifications. Reload the app and try again.";
  }
}

function decodeVapidKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{85,90}$/.test(value)) throw new Error("Invalid public key");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
  if (result.byteLength !== 65 || result[0] !== 4)
    throw new Error("Invalid VAPID public key");
  return result;
}

async function publicVapidKey(): Promise<Uint8Array> {
  const response = await fetch("/api/push/public-key", { cache: "no-store" });
  if (!response.ok) throw new Error("Public VAPID key unavailable");
  const data: unknown = await response.json();
  const key = data && typeof data === "object" && "publicKey" in data
    ? (data as { publicKey?: unknown }).publicKey
    : null;
  if (typeof key !== "string") throw new Error("Public VAPID key unavailable");
  return decodeVapidKey(key);
}

function keysMatch(existing: ArrayBuffer | null, expected: Uint8Array) {
  if (!existing) return true; // Older browsers may not expose subscription options.
  const bytes = new Uint8Array(existing);
  return bytes.length === expected.length &&
    bytes.every((value, index) => value === expected[index]);
}

const inFlight = new Map<string, Promise<WebPushSetupResult>>();

export async function registerBrowserPush(
  userId: string,
  requestPermission = false,
): Promise<WebPushSetupResult> {
  const current = inFlight.get(userId);
  if (current) return current;
  const attempt = (async (): Promise<WebPushSetupResult> => {
    const support = webPushAvailability();
    if (!support.ok) return support;
    let permission = Notification.permission;
    if (permission === "default" && requestPermission) {
      permission = await Notification.requestPermission();
    }
    if (permission === "denied") return { ok: false, reason: "permission_denied" };
    if (permission !== "granted") return { ok: false, reason: "permission_required" };

    let vapidKey: Uint8Array;
    try {
      vapidKey = await publicVapidKey();
    } catch {
      return { ok: false, reason: "vapid_unavailable" };
    }
    try {
      // Register explicitly instead of waiting on serviceWorker.ready, which
      // may never resolve when the registration component missed window.load.
      const registration = await navigator.serviceWorker.register("/sw.js");
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !keysMatch(subscription.options?.applicationServerKey ?? null, vapidKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(vapidKey).buffer as ArrayBuffer,
      });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
        throw new Error("Incomplete browser subscription");

      const existing = await supabase.from("push_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .filter("subscription->>endpoint", "eq", subscription.endpoint)
        .maybeSingle();
      if (existing.error) throw existing.error;

      const now = new Date().toISOString();
      if (existing.data) {
        const updated = await supabase.from("push_subscriptions")
          .update({ subscription: json, updated_at: now })
          .eq("id", existing.data.id)
          .eq("user_id", userId);
        if (updated.error) throw updated.error;
      } else {
        const inserted = await supabase.from("push_subscriptions").insert({
          user_id: userId,
          subscription: json,
          created_at: now,
          updated_at: now,
        });
        if (inserted.error?.code === "23505") {
          // A second tab can race the first; refresh the same user's row.
          const raced = await supabase.from("push_subscriptions")
            .select("id")
            .eq("user_id", userId)
            .filter("subscription->>endpoint", "eq", subscription.endpoint)
            .maybeSingle();
          if (raced.error || !raced.data) throw inserted.error;
          const updated = await supabase.from("push_subscriptions")
            .update({ subscription: json, updated_at: now })
            .eq("id", raced.data.id)
            .eq("user_id", userId);
          if (updated.error) throw updated.error;
        } else if (inserted.error) {
          throw inserted.error;
        }
      }
      return { ok: true };
    } catch (error) {
      console.error("Web push subscription failed:", error);
      return { ok: false, reason: "subscription_failed" };
    }
  })();
  inFlight.set(userId, attempt);
  try {
    return await attempt;
  } finally {
    if (inFlight.get(userId) === attempt) inFlight.delete(userId);
  }
}

/** Sign-out cleanup is best-effort: logout must never be blocked by push. */
export async function unregisterBrowserPush(userId: string): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    await supabase.from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .filter("subscription->>endpoint", "eq", subscription.endpoint)
      .abortSignal(AbortSignal.timeout(2500));
    await subscription.unsubscribe();
  } catch {
    // A disconnected browser or expired session should not prevent sign-out.
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager?.getSubscription();
      await subscription?.unsubscribe();
    } catch { /* best effort */ }
  }
}

export async function unsubscribeBrowserPushLocally(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager?.getSubscription();
  await subscription?.unsubscribe();
}
