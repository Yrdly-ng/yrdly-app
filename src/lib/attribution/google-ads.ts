/**
 * Only confirmed new Supabase account creations generate a Google Ads
 * signup conversion. The AW ID and label are public measurement identifiers,
 * not credentials. Never send email, phone, referrer URLs or raw click IDs.
 *
 * We do not run this in Vercel previews or on third-party origins.
 */
const AD_DESTINATION = "AW-18468457055/8KtMCNjnzYEdEN-UueZE";
const ACCOUNT_RE = /^[0-9a-f-]{36}$/i;

export function reportGoogleAdsSignup(userId: string): boolean {
  if (typeof window === "undefined" ||
      window.location.hostname !== "app.yrdly.ng" ||
      !ACCOUNT_RE.test(userId)) return false;
  try {
    const key = "yrdly_ads_signup_" + userId;
    if (window.sessionStorage.getItem(key) === "1") return false;
    const win = window as typeof window & {
      gtag?: (...args: unknown[]) => void;
      dataLayer?: unknown[];
    };
    const payload = {
      send_to: AD_DESTINATION,
      // Random conversion ID; never share a Supabase account identifier with Ads.
      transaction_id: window.crypto.randomUUID(),
    };
    if (typeof win.gtag === "function") {
      win.gtag("event", "conversion", payload);
    } else if (Array.isArray(win.dataLayer)) {
      win.dataLayer.push(["event", "conversion", payload]);
    } else {
      return false;
    }
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    // Tracking must never interfere with completing registration.
    return false;
  }
}
