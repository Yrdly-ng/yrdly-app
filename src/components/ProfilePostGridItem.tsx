"use client";

import React from "react";
import Image from "next/image";
import { Heart, MessageCircle, PlayCircle, Layers } from "lucide-react";
import type { Post } from "@/types";

interface ProfilePostGridItemProps {
  post: Post;
  onPress: () => void;
}

export function ProfilePostGridItem({ post, onPress }: ProfilePostGridItemProps) {
  const imageUrls = post.image_urls?.length
    ? post.image_urls
    : post.image_url
    ? [post.image_url]
    : [];
  const imageUrl = imageUrls[0] || post.video_thumbnail_url || null;
  const isVideo = !!post.video_url || ((post as any).video_urls && (post as any).video_urls.length > 0);
  const likesCount = post.liked_by?.length || 0;
  const commentCount = post.comment_count || 0;

  return (
    <div
      onClick={onPress}
      className="group relative aspect-square w-full cursor-pointer overflow-hidden rounded-xl bg-muted border border-border/40 transition-all duration-200 hover:shadow-lg"
    >
      {/* Media or Text Content */}
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={post.text || "Post"}
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : isVideo ? (
        <div className="flex h-full w-full items-center justify-center bg-emerald-950/60">
          <PlayCircle className="h-10 w-10 text-primary/80" />
        </div>
      ) : (
        <div className="flex h-full w-full flex-col justify-between p-3.5 bg-gradient-to-br from-card via-background to-muted text-foreground">
          <p className="line-clamp-4 text-xs font-semibold leading-relaxed">
            {post.text || "Post"}
          </p>
          <span className="text-[0.625rem] text-primary font-bold uppercase tracking-wider">
            {post.category || "Post"}
          </span>
        </div>
      )}

      {/* Video Indicator */}
      {isVideo && (
        <div className="absolute top-2 right-2 rounded-full bg-background/70 backdrop-blur-md p-1 shadow-sm">
          <PlayCircle className="h-4 w-4 text-primary" />
        </div>
      )}

      {/* Multiple Images Indicator */}
      {imageUrls.length > 1 && !isVideo && (
        <div className="absolute top-2 right-2 rounded-full bg-background/70 backdrop-blur-md p-1 shadow-sm">
          <Layers className="h-4 w-4 text-primary" />
        </div>
      )}

      {/* Hover Stats Overlay */}
      <div className="absolute inset-0 flex items-center justify-center gap-6 bg-black/50 backdrop-blur-[2px] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="flex items-center gap-1.5 text-white font-bold text-sm">
          <Heart className="h-4 w-4 fill-white" />
          <span>{likesCount}</span>
        </div>
        <div className="flex items-center gap-1.5 text-white font-bold text-sm">
          <MessageCircle className="h-4 w-4 fill-white" />
          <span>{commentCount}</span>
        </div>
      </div>
    </div>
  );
}
