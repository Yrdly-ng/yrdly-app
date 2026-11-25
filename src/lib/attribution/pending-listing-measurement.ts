import { googleMeasurementConsent, googleTagManagerEnabled, reportGoogleConversion } from './google-measurement';
import { authenticatedFetch } from '../auth/authenticated-fetch';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PENDING = 50;
type Pending = { id: string; at: number };
type Listing = { id?: unknown; user_id?: unknown; category?: unknown; visibility?: unknown; moderation_status?: unknown; is_sold?: unknown };

function enabled(): boolean {
  return googleTagManagerEnabled && typeof window !== 'undefined' &&
    window.location.origin === 'https://app.yrdly.ng' && googleMeasurementConsent();
}
function key(owner: string) { return `yrdly:ga4:pending-listings:${owner.toLowerCase()}`; }

function read(owner: string): Pending[] {
  try {
    const rows: unknown = JSON.parse(window.localStorage.getItem(key(owner)) ?? '[]');
    if (!Array.isArray(rows)) return [];
    return rows.filter((r): r is Pending => r && typeof r.id === 'string' && UUID.test(r.id) &&
      typeof r.at === 'number' && Number.isFinite(r.at) && r.at <= Date.now() &&
      Date.now() - r.at <= RETENTION_MS).slice(-MAX_PENDING);
  } catch { return []; }
}
function write(owner: string, rows: Pending[]) {
  try {
    if (rows.length) window.localStorage.setItem(key(owner), JSON.stringify(rows.slice(-MAX_PENDING)));
    else window.localStorage.removeItem(key(owner));
  } catch { /* Measurement may be unavailable. */ }
}

export function publicListingForMeasurement(listing: Listing, owner: string): boolean {
  return typeof listing.id === 'string' && UUID.test(listing.id) && listing.user_id === owner &&
    ['For Sale', 'Giveaway'].includes(String(listing.category)) &&
    typeof listing.visibility === 'string' && listing.visibility.toLowerCase() === 'public' &&
    listing.is_sold !== true;
}

/** Only called with the authenticated server's successful create response. */
export function rememberGoogleListing(listing: unknown): void {
  if (!enabled() || !listing || typeof listing !== 'object') return;
  const row = listing as Listing;
  const owner = row.user_id;
  if (typeof owner !== 'string' || !UUID.test(owner) || !publicListingForMeasurement(row, owner)) return;
  const id = row.id as string;
  if (row.moderation_status === 'approved' && reportGoogleConversion('listing_published', id)) {
    write(owner, read(owner).filter(item => item.id !== id));
    return;
  }
  if (!['approved', 'pending'].includes(String(row.moderation_status))) return;
  const existing = read(owner);
  if (!existing.some(item => item.id === id)) write(owner, [...existing, { id, at: Date.now() }]);
}

/** The seller's browser, not the administrator, reports a delayed approval.
 * The authenticated endpoint rechecks ownership and the actual saved post.
 */
export async function recoverGoogleListings(owner: string, isCurrent: () => boolean): Promise<void> {
  if (!enabled() || !UUID.test(owner) || !isCurrent()) return;
  const pending = read(owner);
  write(owner, pending);
  for (const item of pending) {
    if (!enabled() || !isCurrent()) return;
    try {
      const response = await authenticatedFetch<{ data?: Listing }>(`/api/posts?id=${encodeURIComponent(item.id)}`, undefined, 'GET');
      if (!enabled() || !isCurrent()) return;
      const row = response.data;
      if (!row || row.id !== item.id || !publicListingForMeasurement(row, owner) || row.moderation_status === 'rejected' ||
        (row.moderation_status === 'approved' && reportGoogleConversion('listing_published', item.id))) {
        write(owner, read(owner).filter(entry => entry.id !== item.id));
      }
    } catch (error) {
      if (!enabled() || !isCurrent()) return;
      if ((error as { status?: number })?.status === 404) write(owner, read(owner).filter(entry => entry.id !== item.id));
    }
  }
}
