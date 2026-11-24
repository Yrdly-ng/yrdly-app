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

export function setGoogleMeasurementConsent(allowed: boolean): void {
  document.cookie = `${CONSENT_COOKIE}=${allowed}; Domain=yrdly.ng; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
}

function dataLayer(): unknown[] | undefined {
  if (!googleTagManagerEnabled || typeof window === 'undefined' ||
      window.location.origin !== APP_ORIGIN || !googleMeasurementConsent()) return;

  const target = window as Window & { dataLayer?: unknown[] };
  const queue = target.dataLayer ??= [];
  if (!document.getElementById('yrdly-gtm')) {
    const script = document.createElement('script');
    script.id = 'yrdly-gtm';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${CONTAINER_ID}`;
    queue.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    document.head.appendChild(script);
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
  queue.push({ event: 'yrdly_page_view', measurement_page_location: url.href });
  lastPage = path;
}

/** IDs are used locally for deduplication and excluded from the event payload. */
export function reportGoogleConversion(event: Conversion, localId: string): void {
  if (!publishedEvents.has(event) || !UUID.test(localId)) return;
  try {
    const queue = dataLayer();
    if (!queue) return;
    const key = `yrdly:ga4:${event}:${localId.toLowerCase()}`;
    if (window.sessionStorage.getItem(key)) return;
    queue.push({ ecommerce: null }, { event });
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Measurement must never interfere with a successful application action.
  }
}

/** Only call from an authenticated, server-confirmed payment. */
export async function reportGooglePurchase(orderId: string, amount: unknown, kind: 'post' | 'catalog_item' | 'ticket' | 'booking'): Promise<void> {
  if (!['post', 'catalog_item', 'ticket', 'booking'].includes(kind) || !UUID.test(orderId) || (typeof amount !== 'number' && typeof amount !== 'string')) return;
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) return;
  try {
    if (!dataLayer()) return;
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`yrdly-ga4-purchase:${orderId.toLowerCase()}`));
    const transactionId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const queue = dataLayer();
    if (!queue) return;
    const key = `yrdly:ga4:purchase:${transactionId}`;
    if (window.sessionStorage.getItem(key)) return;
    queue.push({ ecommerce: null }, {
      event: 'purchase',
      ecommerce: {
        transaction_id: transactionId,
        currency: 'NGN',
        value,
        items: [{ item_id: kind === 'post' ? 'marketplace_listing' : kind, price: value, quantity: 1 }],
      },
    });
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Checkout can complete regardless of tracking or browser storage support.
  }
}
