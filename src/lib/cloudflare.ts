/**
 * Cloudflare CDN and R2 Helper Utilities for yrdly.ng
 */

const SUPABASE_STORAGE_HOST = 'yoiyqxtpmxnrrbqqidcs.supabase.co';
const CLOUDFLARE_CDN_BASE = process.env.NEXT_PUBLIC_CLOUDFLARE_CDN_URL || 'https://media.yrdly.ng';

/**
 * Transforms a Supabase Storage asset URL to pass through the Cloudflare CDN edge proxy (media.yrdly.ng).
 * Falls back to the original URL if CDN is not configured or URL is invalid.
 */
export function getCdnMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  
  // If CDN URL is configured and URL points to Supabase storage, proxy via Cloudflare
  if (url.includes(SUPABASE_STORAGE_HOST) && CLOUDFLARE_CDN_BASE) {
    try {
      const parsed = new URL(url);
      const cdnParsed = new URL(CLOUDFLARE_CDN_BASE);
      parsed.protocol = cdnParsed.protocol;
      parsed.host = cdnParsed.host;
      return parsed.toString();
    } catch {
      return url;
    }
  }
  
  return url;
}
