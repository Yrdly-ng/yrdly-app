const IMAGE_LIMIT = 5 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['yoiyqxtpmxnrrbqqidcs.supabase.co','api.yrdly.ng','app.yrdly.ng','lh3.googleusercontent.com']);

export async function fetchSafeImage(src: string): Promise<Buffer> {
  if (src.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(src);
    if (!match || match[1].length > Math.ceil(IMAGE_LIMIT*4/3)+4) throw new Error('Invalid embedded image');
    const buffer = Buffer.from(match[1],'base64');
    if (buffer.length > IMAGE_LIMIT) throw new Error('Image exceeds size limit');
    return buffer;
  }
  const url = new URL(src);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || url.port) throw new Error('Image origin is not allowed');
  const response = await fetch(url,{ redirect:'manual',signal:AbortSignal.timeout(5000) });
  if (!response.ok || response.status >= 300 || !/^image\/(png|jpeg|webp|gif|avif)(;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Invalid image response');
  if (Number(response.headers.get('content-length')) > IMAGE_LIMIT) { await response.body?.cancel(); throw new Error('Image exceeds size limit'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty image response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done,value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMAGE_LIMIT) { await reader.cancel(); throw new Error('Image exceeds size limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks,size);
}
