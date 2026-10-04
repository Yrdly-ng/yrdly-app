import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Small square avatar used as the link-preview thumbnail (WhatsApp, iMessage, etc.).
// Images under ~300px wide are shown as a small thumbnail beside the text, like X.
export const runtime = 'nodejs';
export const revalidate = 300;

const SIZE = 120;
const FALLBACK_LOGO = 'https://app.yrdly.ng/logo.png';

async function fetchBuffer(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;

  const { data: post } = await supabaseAdmin
    .from('posts')
    .select('author_image, user:users!posts_user_id_fkey(avatar_url)')
    .eq('id', postId)
    .maybeSingle();

  const user: any = Array.isArray(post?.user) ? post?.user[0] : post?.user;
  const avatar: string | undefined = user?.avatar_url || post?.author_image || undefined;

  let input: Buffer | null = null;
  for (const src of [avatar, FALLBACK_LOGO]) {
    if (!src) continue;
    try {
      input = await fetchBuffer(src);
      break;
    } catch {}
  }
  if (!input) return new Response('Not found', { status: 404 });

  const jpeg = await sharp(input)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer();

  return new Response(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}