import { Metadata } from 'next';
import { Suspense } from 'react';
import { PostPageClient } from './PostPageClient';
import { createClient } from '@/lib/supabase-server';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const resolvedParams = await params;
  const supabase = await createClient();
  
  const { data: post } = await supabase
    .from('posts')
    .select('*')
    .eq('id', resolvedParams.id)
    .single();

  if (!post) {
    return {
      title: 'Post Not Found | Yrdly',
    };
  }

  const title = post.title || 'Check out this post on Yrdly';
  const description = post.text ? (post.text.length > 100 ? post.text.substring(0, 100) + '...' : post.text) : 'A post on Yrdly';
  // Use either the image_urls array or image_url fallback
  const images = post.image_urls && post.image_urls.length > 0 
    ? post.image_urls 
    : (post.image_url ? [post.image_url] : ['https://app.yrdly.ng/logo.png']);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images,
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
