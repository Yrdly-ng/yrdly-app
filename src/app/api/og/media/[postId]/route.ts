import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Large link-preview image for posts that have a photo or a video.
// Photo posts use their first photo; video posts use the saved thumbnail with a play badge.
// Output is 1200x630 (the size X, YouTube and Instagram previews use) and kept under
// ~280 KB because WhatsApp skips preview images bigger than about 300 KB.
//
// Add ?debug=1 to the URL to see what the route found instead of an image.
export const runtime = 'nodejs';
export const maxDuration = 20;

const W = 1200;
const H = 630;
const MAX_BYTES = 280 * 1024;

function firstUrl(value: unknown): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return typeof value[0] === 'string' && value[0] ? value[0] : null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t);
        return Array.isArray(arr) && typeof arr[0] === 'string' ? arr[0] : null;
      } catch {
        return null;
      }
    }
    return t || null;
  }
  return null;
}

async function loadImage(src: string): Promise<Buffer> {
  // Video thumbnails are saved on the post as base64 data URLs
  if (src.startsWith('data:')) {
    return Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const PLAY_BADGE = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <circle cx="${W / 2}" cy="${H / 2}" r="78" fill="rgba(0,0,0,0.6)"/>
    <polygon points="${W / 2 - 22},${H / 2 - 38} ${W / 2 - 22},${H / 2 + 38} ${W / 2 + 40},${H / 2}" fill="#ffffff"/>
  </svg>`
);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;
  const debug = new URL(req.url).searchParams.get('debug') === '1';
  const info: Record<string, unknown> = { postId };

  try {
    // select('*') so a missing column can't break the lookup
    const { data: post, error } = await supabaseAdmin
      .from('posts')
      .select('*')
      .eq('id', postId)
      .maybeSingle();

    info.postFound = !!post;
    info.queryError = error?.message ?? null;

    const photo = firstUrl(post?.image_urls) || firstUrl(post?.image_url);
    const hasVideoThumb = !!post?.video_url && !!post?.video_thumbnail_url;
    const isVideo = !photo && hasVideoThumb;
    const source = photo || (isVideo ? (post?.video_thumbnail_url as string) : null);

    info.photo = photo;
    info.hasVideo = !!post?.video_url;
    info.hasVideoThumbnail = !!post?.video_thumbnail_url;
    info.using = photo ? 'photo' : isVideo ? 'video thumbnail' : 'nothing (text-only post)';

    if (!source) throw new Error('post has no photo or video thumbnail');

    const input = await loadImage(source);
    info.sourceBytes = input.length;

    // Center crop (fast). failOn:'none' tolerates slightly broken phone photos.
    let pipeline = sharp(input, { failOn: 'none' })
      .rotate()
      .resize(W, H, { fit: 'cover', position: 'centre' })
      .flatten({ background: '#000000' });

    if (isVideo) {
      const base = await pipeline.png().toBuffer();
      pipeline = sharp(base).composite([{ input: PLAY_BADGE }]);
    }

    let out: Buffer = Buffer.alloc(0);
    for (const quality of [80, 70, 60, 50, 40]) {
      out = await pipeline.clone().jpeg({ quality }).toBuffer();
      if (out.length <= MAX_BYTES) break;
    }
    info.outputBytes = out.length;

    if (debug) return Response.json({ ok: true, ...info });

    return new Response(new Uint8Array(out), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
      },
    });
  } catch (err: any) {
    console.error('og media route failed', info, err);
    if (debug) return Response.json({ ok: false, error: String(err?.message || err), ...info });
    // Normal requests: fall back to the author's avatar image
    return Response.redirect(new URL(`/api/og/avatar/${postId}`, req.url), 302);
  }
}