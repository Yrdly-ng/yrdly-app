import { Metadata } from 'next';
import { Suspense } from 'react';
import { PostPageClient } from './PostPageClient';
import { createClient } from '@supabase/supabase-js';

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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: post } = await supabase
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
  const author = post.user?.name || post.author_name || 'A neighbor';
  const handle = post.user?.username ? ` (@${post.user.username})` : '';
  const title = `${author}${handle} on Yrdly`;
  const description = clip(post.text || post.title || 'See this post on Yrdly', 280);

  const postImage = post.image_urls?.[0] || post.image_url;
  const image =
    (USE_POST_PHOTO && postImage) || post.user?.avatar_url || FALLBACK_IMAGE;

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
      images: [image],
    },
    twitter: {
      card: USE_POST_PHOTO && postImage ? 'summary_large_image' : 'summary',
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