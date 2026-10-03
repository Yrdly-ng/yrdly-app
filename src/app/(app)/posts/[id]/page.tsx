import { Metadata } from 'next';
import { Suspense } from 'react';
import { PostPageClient } from './PostPageClient';
import { createClient } from '@supabase/supabase-js';

// Re-generate previews at most once a minute so edited posts refresh
export const revalidate = 60;

const SITE_URL = 'https://app.yrdly.ng';
const FALLBACK_IMAGE = `${SITE_URL}/logo.png`;

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '\u2026' : clean;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const url = `${SITE_URL}/posts/${id}`;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: post } = await supabase
    .from('posts')
    .select('*, user:users!posts_user_id_fkey(name, avatar_url)')
    .eq('id', id)
    .maybeSingle();

  if (!post) {
    return {
      title: 'Yrdly - Your Neighborhood Network',
      description: 'Connect with your neighbors on Yrdly.',
      openGraph: { url, siteName: 'Yrdly', type: 'website', images: [FALLBACK_IMAGE] },
    };
  }

  // X-style preview: "<Author> on Yrdly", the post text, and the post photo
  // (or the author's avatar when the post has no photo)
  const author = post.user?.name || post.author_name || 'A neighbor';
  const title = post.title ? clip(post.title, 70) : `${author} on Yrdly`;
  const description = post.text ? clip(post.text, 200) : 'See this post on Yrdly';

  const postImage = post.image_urls?.[0] || post.image_url;
  const image = postImage || post.user?.avatar_url || FALLBACK_IMAGE;

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
      card: postImage ? 'summary_large_image' : 'summary',
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
