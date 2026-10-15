"use client";

import Image, { type ImageProps } from 'next/image';
import type { VideoHTMLAttributes } from 'react';
import { usePrivateMedia } from '@/hooks/use-private-media';

export function PrivateMediaImage({ src, alt, ...props }: Omit<ImageProps, 'src'> & { src: string }) {
  const { url, error } = usePrivateMedia(src);
  if (!url) return <span role="img" aria-label={error ? `${alt} unavailable` : `Loading ${alt}`} className="block min-h-6 text-xs text-muted-foreground">{error ? 'Image unavailable' : 'Loading image…'}</span>;
  return <Image {...props} src={url} alt={alt} unoptimized />;
}

export function PrivateMediaVideo({ src, ...props }: Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> & { src: string }) {
  const { url, error } = usePrivateMedia(src);
  if (!url) return <span role="status" className="block p-3 text-xs text-muted-foreground">{error ? 'Video unavailable' : 'Loading video…'}</span>;
  return <video {...props} src={`${url}#t=0.001`} />;
}
