import { signupAttribution } from './signup';

const APP_ORIGIN = 'https://app.yrdly.ng';
const CONTAINER_ID = 'GTM-M9WNM5GG';
const CONSENT_COOKIE = 'yrdly_cookie_consent';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const publicPaths = new Set(['/', '/login', '/home', '/marketplace', '/businesses', '/events', '/communities', '/explore']);
const publishedEvents = new Set(['sign_up', 'listing_published', 'business_created'] as const);
type Conversion = 'sign_up' | 'listing_published' | 'business_created';

export const googleTagManagerEnabled = process.env.NEXT_PUBLIC_YRDLY_GOOGLE_MEASUREMENT === 'gtm';

export function googleMeasurementConsent(cookie = document.cookie): boolean {
  const cookies = cookie.split(/;\s*/);
  return cookies.includes(`${CONSENT_COOKIE}=true`) && !cookies.includes(`${CONSENT_COOKIE}=false`);
}

let consentActive = false;

function queueConsent(queue: unknown[], command: 'default' | 'update', allowed: boolean): void {
  const storage = allowed ? 'granted' : 'denied';
  function gtag(...args: unknown[]) { void args; queue.push(arguments); }
  gtag('consent', command, {
    analytics_storage: storage, ad_storage: storage,
    ad_user_data: 'denied', ad_personalization: 'denied',
  });
}

export function clearPendingListingMeasurement(): void {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index--) {
      const key = window.localStorage.key(index);
      if (key?.startsWith('yrdly:ga4:pending-listings:')) window.localStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable. */ }
}

export function syncGoogleMeasurementConsent(): void {
  if (typeof window === 'undefined' || !googleTagManagerEnabled || window.location.origin !== APP_ORIGIN) return;
  if (googleMeasurementConsent()) return;
  const queue = (window as Window & { dataLayer?: unknown[] }).dataLayer;
  if (consentActive && queue) queueConsent(queue, 'update', false);
  consentActive = false;
  lastPage = undefined;
  clearPendingListingMeasurement();
}

export function setGoogleMeasurementConsent(allowed: boolean): void {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  document.cookie = `${CONSENT_COOKIE}=${allowed}; Domain=yrdly.ng; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
  if (!allowed) syncGoogleMeasurementConsent();
  window.dispatchEvent(new Event('yrdly:cookie-consent'));
}

function dataLayer(): unknown[] | undefined {
  if (!googleTagManagerEnabled || typeof window === 'undefined' ||
      window.location.origin !== APP_ORIGIN) return;
  if (!googleMeasurementConsent()) { syncGoogleMeasurementConsent(); return; }

  const target = window as Window & { dataLayer?: unknown[] };
  const queue = target.dataLayer ??= [];
  if (!document.getElementById('yrdly-gtm')) {
    queueConsent(queue, 'default', false);
    queueConsent(queue, 'update', true);
    consentActive = true;
    const script = document.createElement('script');
    script.id = 'yrdly-gtm';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${CONTAINER_ID}`;
    queue.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    document.head.appendChild(script);
  } else if (!consentActive) {
    queueConsent(queue, 'update', true);
    consentActive = true;
  }
  return queue;
}

let lastPage: string | undefined;

export function trackGooglePage(path: string): void {
  if (path === lastPage) return;
  lastPage = undefined;
  if (!publicPaths.has(path)) return;
  const queue = dataLayer();
  if (!queue) return;
  const url = new URL(path, APP_ORIGIN);
  const { last } = signupAttribution();
  for (const [key, value] of Object.entries({
    utm_source: last.source, utm_medium: last.medium,
    utm_campaign: last.campaign,
  })) {
    if (value && value !== 'unknown' && /^[a-z][a-z0-9._-]{0,63}$/i.test(value)) url.searchParams.set(key, value);
  }
  queue.push({ event: 'yrdly_page_view', measurement_page_location: url.href, measurement_page_referrer: '', measurement_page_title: 'YRDLY' });
  lastPage = path;
}

/** IDs are used locally for deduplication and excluded from the event payload. */
export function reportGoogleConversion(event: Conversion, localId: string): boolean {
  if (!publishedEvents.has(event) || typeof localId !== 'string' || !UUID.test(localId)) return false;
  try {
    const queue = dataLayer();
    if (!queue) return false;
    const key = `yrdly:ga4:${event}:${localId.toLowerCase()}`;
    const storage = event === 'listing_published' ? window.localStorage ?? window.sessionStorage : window.sessionStorage;
    if (storage.getItem(key) || window.sessionStorage.getItem(key)) return true;
    storage.setItem(key, '1');
    queue.push({ ecommerce: null }, { event, ...safeConversionPage() });
    return true;
  } catch {
    // Measurement must never interfere with a successful application action.
    return false;
  }
}

function safeConversionPage() {
  // Conversion pages frequently contain order IDs and callback tokens.
  return { measurement_page_location: `${APP_ORIGIN}/other`, measurement_page_referrer: '', measurement_page_title: 'YRDLY' };
}

/** Only call from an authenticated, server-confirmed payment. */
export async function reportGooglePurchase(orderId: string, amount: unknown, kind: 'post' | 'catalog_item' | 'ticket' | 'booking'): Promise<void> {
  if (!['post', 'catalog_item', 'ticket', 'booking'].includes(kind) || typeof orderId !== 'string' || !UUID.test(orderId) || (typeof amount !== 'number' && typeof amount !== 'string')) return;
  if (typeof amount === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(amount)) return;
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) return;
  try {
    if (!dataLayer()) return;
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`yrdly-ga4-purchase:${orderId.toLowerCase()}`));
    const transactionId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const queue = dataLayer();
    if (!queue) return;
    const key = `yrdly:ga4:purchase:${transactionId}`;
    // Persist the opaque ID across tab closures; never persist payment credentials.
    const storage = window.localStorage ?? window.sessionStorage;
    if (storage.getItem(key) || window.sessionStorage.getItem(key)) return;
    storage.setItem(key, '1');
    queue.push({ ecommerce: null }, {
      event: 'purchase',
      ...safeConversionPage(),
      ecommerce: {
        transaction_id: transactionId,
        currency: 'NGN',
        value,
        items: [{ item_id: kind === 'post' ? 'marketplace_listing' : kind, price: value, quantity: 1 }],
      },
    });
  } catch {
    // Checkout can complete regardless of tracking or browser storage support.
  }
}

/** Only consume the measurement-specific fields returned by the authenticated verify endpoint. */
export function reportVerifiedMarketplacePurchase(result: unknown): void {
  if (!result || typeof result !== 'object') return;
  const payment = result as { success?: unknown; transactionId?: unknown; measurementAmount?: unknown; measurementKind?: unknown };
  if (payment.success !== true || typeof payment.transactionId !== 'string' ||
      (payment.measurementKind !== 'post' && payment.measurementKind !== 'catalog_item')) return;
  void reportGooglePurchase(payment.transactionId, payment.measurementAmount, payment.measurementKind);
}
