import { Metadata } from 'next';
import { Suspense } from 'react';
import { PostPageClient } from './PostPageClient';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Re-generate previews at most once a minute so edited posts refresh
export const revalidate = 60;

const SITE_URL = 'https://app.yrdly.ng';
const FALLBACK_IMAGE = `${SITE_URL}/logo.png`;

// Keeps line breaks (like X does) but trims stray whitespace and clips long text
function clip(text: string, max: number) {
  const clean = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '\u2026' : clean;
}

// false = author avatar as a small square thumbnail on the left (exactly like the X preview)
// true  = use the post photo when there is one (WhatsApp shows it as a big image on top)
const USE_POST_PHOTO = false;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const url = `${SITE_URL}/posts/${id}`;

  // Server-side lookup with the admin client: link-preview crawlers aren't logged in,
  // so the public (anon) client can't read the author's row and the preview loses
  // the username and avatar. Only public fields are used below.
  const { data: post } = await supabaseAdmin
    .from('posts')
    .select('*, user:users!posts_user_id_fkey(name, username, avatar_url)')
    .eq('id', id)
    .maybeSingle();

  if (!post) {
    return {
      title: 'Yrdly - Your Neighborhood Network',
      description: 'Connect with your neighbors on Yrdly.',
      openGraph: { url, siteName: 'Yrdly', type: 'website', images: [FALLBACK_IMAGE] },
    };
  }

  // X-style preview: "<Name> (@username) on Yrdly", the full post text,
  // and the author's avatar as a small thumbnail
  const user = Array.isArray(post.user) ? post.user[0] : post.user;
  const author = user?.name || post.author_name || 'A neighbor';
  const handle = user?.username ? ` (@${user.username})` : '';
  const title = `${author}${handle} on Yrdly`;
  const description = clip(post.text || post.title || 'See this post on Yrdly', 280);

  const postImage = post.image_urls?.[0] || post.image_url;
  const usePhoto = USE_POST_PHOTO && !!postImage;
  // The avatar goes through a route that resizes it to 200x200 so WhatsApp shows it
  // as a small thumbnail on the left, like X (big images become a large card on top)
  const image = usePhoto ? postImage : `${SITE_URL}/api/og/avatar/${id}`;
  const ogImage = usePhoto
    ? { url: image }
    : { url: image, width: 200, height: 200, alt: author };

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'Yrdly',
      type: 'article',
      images: [ogImage],
    },
    twitter: {
      card: usePhoto ? 'summary_large_image' : 'summary',
      title,
      description,
      images: [image],
    },
  };
}

// Required for static export compatibility
export async function generateStaticParams() {
  return [];
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PostPageClient postId={resolvedParams.id} />
    </Suspense>
  );
}