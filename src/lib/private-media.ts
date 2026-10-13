export const PRIVATE_MEDIA_BUCKETS = ['chat-images', 'chat-videos', 'reports'] as const;
export type PrivateMediaBucket = typeof PRIVATE_MEDIA_BUCKETS[number];
const storageHosts = new Set(['yoiyqxtpmxnrrbqqidcs.supabase.co', 'api.yrdly.ng']);
if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  storageHosts.add(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname);
}

export function validatePrivateMediaPath(path: string): string {
  if (!path || path.length > 1024 || /[\\\x00-\x1f\x7f?#]/.test(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..' || /%[0-9a-f]{2}/i.test(part))) {
    throw new Error('Invalid media path');
  }
  return path;
}

export function privateMediaReference(bucket: PrivateMediaBucket, path: string): string {
  return `storage://${bucket}/${validatePrivateMediaPath(path).split('/').map(encodeURIComponent).join('/')}`;
}

// Old project-host public URLs remain resolvable after the bucket becomes private.
// They are converted to an object reference and re-authorized, never fetched publicly.
export function parsePrivateMediaReference(value: string): { bucket: PrivateMediaBucket; path: string } | null {
  let bucket: string;
  let path: string;
  if (value.startsWith('storage://')) {
    const match = /^storage:\/\/([^/]+)\/(.+)$/.exec(value);
    if (!match) throw new Error('Invalid media reference');
    [, bucket, path] = match;
  } else {
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || !storageHosts.has(url.hostname) || url.username || url.password || url.port) return null;
    const match = /^\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (!match || !PRIVATE_MEDIA_BUCKETS.includes(match[1] as PrivateMediaBucket)) return null;
    [, bucket, path] = match;
  }
  if (!PRIVATE_MEDIA_BUCKETS.includes(bucket as PrivateMediaBucket)) throw new Error('Invalid media bucket');
  return { bucket: bucket as PrivateMediaBucket, path: validatePrivateMediaPath(decodeURIComponent(path)) };
}

export function mediaConversationId(path: string): string | null {
  const parts = path.split('/');
  const id = parts[0] === 'chat' ? parts[1] : parts[0];
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '') ? id : null;
}
