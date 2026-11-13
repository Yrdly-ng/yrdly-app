/**
 * Bounded, first-party signup attribution. No raw page/referrer URLs, click IDs,
 * IP addresses, email addresses or untrusted free-text fields are persisted.
 *
 * Marketing site writes an optional consented .yrdly.ng cookie; the app keeps
 * incoming attribution for this browser tab only until registration completes.
 */
export type AcquisitionTouch = {
  source: string;
  medium: string;
  campaign?: string;
  referring_domain?: string;
};

export type SignupAttribution = {
  version: 1;
  first: AcquisitionTouch;
  last: AcquisitionTouch;
  captured_at: string;
};

const SESSION_KEY = "yrdly_signup_attribution_session";
const COOKIE_KEY = "yrdly_signup_attribution";
const SAFE_VALUE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function safeValue(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const cleaned = value.trim().toLowerCase();
  return SAFE_VALUE.test(cleaned) ? cleaned : undefined;
}

function validTouch(value: unknown): AcquisitionTouch | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AcquisitionTouch>;
  const source = safeValue(row.source), medium = safeValue(row.medium);
  if (!source || !medium) return null;
  const touch: AcquisitionTouch = { source, medium };
  if (row.campaign !== undefined) {
    const campaign = safeValue(row.campaign);
    if (!campaign) return null;
    touch.campaign = campaign;
  }
  if (row.referring_domain !== undefined) {
    const referringDomain = safeValue(row.referring_domain);
    if (!referringDomain) return null;
    touch.referring_domain = referringDomain;
  }
  return touch;
}

function parseRecord(serialized: string | null): SignupAttribution | null {
  if (!serialized || serialized.length > 1500) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const first = validTouch(row.first);
    const last = validTouch(row.last);
    const capturedAt = typeof row.captured_at === "string" ? row.captured_at : "";
    const stamp = Date.parse(capturedAt);
    if (!first || !last || !Number.isFinite(stamp) ||
        stamp > Date.now() + 60_000 || Date.now() - stamp > MAX_AGE_MS) return null;
    return { version: 1, first, last, captured_at: capturedAt };
  } catch {
    return null;
  }
}

function cookieRecord(): SignupAttribution | null {
  if (typeof document === "undefined") return null;
  const entry = document.cookie.split("; ").find(s => s.startsWith(COOKIE_KEY + "="));
  if (!entry) return null;
  try {
    const decoded = decodeURIComponent(entry.slice(COOKIE_KEY.length + 1));
    return parseRecord(decoded);
  } catch {
    return null;
  }
}

function sessionRecord(): SignupAttribution | null {
  if (typeof window === "undefined") return null;
  try { return parseRecord(window.sessionStorage.getItem(SESSION_KEY)); }
  catch { return null; }
}

function referrerDomain(referrer: string): string | undefined {
  try {
    const parsed = new URL(referrer);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    const host = parsed.hostname.toLowerCase();
    return safeValue(host);
  } catch { return; }
}

export function acquisitionTouch(url: URL, referrer: string): AcquisitionTouch | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const q = url.searchParams;
  const domain = referrerDomain(referrer);
  let source = safeValue(q.get("utm_source"));
  let medium = safeValue(q.get("utm_medium"));
  if (!source && (q.has("gclid") || q.has("gad_source"))) {
    source = "google"; medium = "cpc";
  } else if (!source && q.has("msclkid")) {
    source = "bing"; medium = "cpc";
  } else if (!source && domain) {
    if (/(^|\.)yrdly\.ng$/.test(domain)) {
      source = "yrdly_website"; medium = "referral";
    } else {
      source = /(^|\.)google\.[a-z.]+$/.test(domain) ? "google"
        : /(^|\.)bing\.com$/.test(domain) ? "bing"
        : /(^|\.)(instagram\.com|l\.instagram\.com)$/.test(domain) ? "instagram"
        : /(^|\.)tiktok\.com$/.test(domain) ? "tiktok"
        : /(^|\.)(twitter\.com|t\.co|x\.com)$/.test(domain) ? "x"
        : /(^|\.)(facebook\.com|fb\.com)$/.test(domain) ? "facebook"
        : domain;
      medium = ["google", "bing"].includes(source) ? "organic" : "referral";
    }
  }
  if (!source) return null;
  const campaign = safeValue(q.get("utm_campaign"));
  const touch: AcquisitionTouch = { source, medium: medium ?? "referral" };
  if (campaign) touch.campaign = campaign;
  if (domain && !/(^|\.)yrdly\.ng$/.test(domain)) touch.referring_domain = domain;
  return touch;
}

/** Called from the app's root layout on first visit. Best effort, nonblocking. */
export function captureAcquisitionLanding(): void {
  if (typeof window === "undefined") return;
  try {
    const persisted = cookieRecord() ?? sessionRecord();
    const incoming = acquisitionTouch(new URL(window.location.href), document.referrer);
    if (!persisted && !incoming) return;
    const record: SignupAttribution = {
      version: 1,
      first: persisted?.first ?? incoming!,
      last: incoming ?? persisted!.last,
      captured_at: persisted?.captured_at ?? new Date().toISOString(),
    };
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(record));
  } catch {
    // Never block navigation or signup when client-side storage is unavailable.
  }
}

/**
 * Read the attribution used on account creation. Unknown traffic remains
 * "direct/unknown": no fabricated source or raw referrer is sent to PostHog.
 */
export function signupAttribution(): SignupAttribution {
  const stored = sessionRecord() ?? cookieRecord();
  if (stored) return stored;
  if (typeof window !== "undefined") {
    try {
      const fresh = acquisitionTouch(new URL(window.location.href), document.referrer);
      if (fresh) return { version: 1, first: fresh, last: fresh, captured_at: new Date().toISOString() };
    } catch { /* no source */ }
  }
  const unknown: AcquisitionTouch = { source: "unknown", medium: "unknown" };
  return { version: 1, first: unknown, last: unknown, captured_at: new Date().toISOString() };
}
