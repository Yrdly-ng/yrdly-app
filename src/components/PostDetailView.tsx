"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircleMore,
  Share2,
  MoreHorizontal,
  Trash2,
  Edit,
  Play,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { usePosts } from "@/hooks/use-posts";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { CommentSection } from "@/components/CommentSection";
import { timeAgo } from "@/lib/utils";
import type { Post, User } from "@/types";
import { cn } from "@/lib/utils";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

interface PostDetailViewProps {
  post: Post;
  onCommentCountChange?: (count: number) => void;
}

export function PostDetailView({ post, onCommentCountChange }: PostDetailViewProps) {
  const router = useRouter();
  const { user: currentUser, profile: userDetails } = useAuth();
  const { toast } = useToast();
  const [author, setAuthor] = useState<User | null>(null);
  const [loadingAuthor, setLoadingAuthor] = useState(true);
  const [likes, setLikes] = useState(post.liked_by?.length || 0);
  const [commentCount, setCommentCount] = useState(post.comment_count || 0);
  const [isLiked, setIsLiked] = useState(false);
  const [isEventEditDialogOpen, setIsEventEditDialogOpen] = useState(false);
  const [isPostEditDialogOpen, setIsPostEditDialogOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const { createPost } = usePosts();

  const handleScroll = () => {
    if (!carouselRef.current) return;
    const el = carouselRef.current;
    const scrollPos = el.scrollLeft;
    const width = el.clientWidth;
    if (width > 0) {
      const idx = Math.round(scrollPos / width);
      setActiveIndex(idx);
    }
  };

  const scrollToSlide = (idx: number) => {
    if (!carouselRef.current) return;
    const width = carouselRef.current.clientWidth;
    carouselRef.current.scrollTo({ left: width * idx, behavior: "smooth" });
    setActiveIndex(idx);
  };

  useEffect(() => {
    const fetchAuthor = async () => {
      if (!post.user_id) {
        setAuthor({
          id: "unknown",
          uid: "unknown",
          name: post.author_name || "Anonymous",
          avatar_url: post.author_image || "https://placehold.co/100x100.png",
          timestamp: post.timestamp,
        });
        setLoadingAuthor(false);
        return;
      }
      if (post.user) {
        setAuthor({
          id: post.user_id,
          uid: post.user_id,
          name: post.user.name || post.author_name || "Anonymous",
          avatar_url: post.user.avatar_url || post.author_image || "https://placehold.co/100x100.png",
          timestamp: post.timestamp,
        });
        setLoadingAuthor(false);
        return;
      }
      const { data } = await supabase.from("users").select("id, name, avatar_url, created_at").eq("id", post.user_id).single();
      if (data) {
        setAuthor({
          id: data.id,
          uid: data.id,
          name: data.name || post.author_name || "Anonymous",
          avatar_url: data.avatar_url || post.author_image || "https://placehold.co/100x100.png",
          timestamp: data.created_at || post.timestamp,
        });
      } else {
        setAuthor({
          id: post.user_id,
          uid: post.user_id,
          name: post.author_name || "Anonymous",
          avatar_url: post.author_image || "https://placehold.co/100x100.png",
          timestamp: post.timestamp,
        });
      }
      setLoadingAuthor(false);
    };
    fetchAuthor();
  }, [post.user_id, post.user, post.author_name, post.author_image, post.timestamp]);

  useEffect(() => {
    setLikes(post.liked_by?.length || 0);
    setCommentCount(post.comment_count || 0);
    if (currentUser && post.liked_by) setIsLiked(post.liked_by.includes(currentUser.id));
    const ch = supabase
      .channel(`post-detail-${post.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `id=eq.${post.id}` }, (payload: any) => {
        if (payload.new) {
          const p = payload.new;
          setLikes(p.liked_by?.length || 0);
          setCommentCount(p.comment_count || 0);
          if (currentUser && p.liked_by) setIsLiked(p.liked_by.includes(currentUser.id));
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [post.id, post.liked_by, post.comment_count, currentUser]);

  const handleBack = () => {
    if (post.category === "Event") router.push("/events");
    else if (post.category === "For Sale") router.push("/marketplace");
    else router.push("/home");
  };

  const handleLike = useCallback(async () => {
    if (!currentUser || !post.id) return;
    setIsLiked((prevIsLiked) => {
      const nextIsLiked = !prevIsLiked;
      setLikes((prevLikes) => (nextIsLiked ? prevLikes + 1 : Math.max(0, prevLikes - 1)));

      supabase.rpc("toggle_post_like", {
        p_post_id: post.id,
        p_user_id: currentUser.id,
      }).then(({ data, error }) => {
        if (error || !data) {
          setIsLiked(prevIsLiked);
          setLikes((prevLikes) => (prevIsLiked ? prevLikes + 1 : Math.max(0, prevLikes - 1)));
        } else {
          setIsLiked(data.is_liked);
          setLikes(data.likes_count);
        }
      });

      return nextIsLiked;
    });
  }, [currentUser, post.id]);

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/posts/${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Post on Yrdly", url });
        toast({ title: "Post shared!" });
      } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied!" });
    }
  }, [post.id, toast]);

  const handleDelete = useCallback(async () => {
    if (!currentUser || currentUser.id !== post.user_id) return;
    await supabase.from("posts").delete().eq("id", post.id);
    await supabase.from("comments").delete().eq("post_id", post.id);
    toast({ title: "Post deleted" });
    router.push("/home");
  }, [currentUser, post.id, post.user_id, router, toast]);

  const handleCommentCountChange = useCallback(
    (count: number) => {
      setCommentCount(count);
      onCommentCountChange?.(count);
    },
    [onCommentCountChange]
  );

  const urls = post.image_urls?.length ? post.image_urls : post.image_url ? [post.image_url] : [];
  const hasThreeOrMore = urls.length >= 3;

  return (
    <div
      className={cn(
        "w-full rounded-[16px] overflow-hidden border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl text-[var(--yrdly-text-primary)] font-yrdly-body shadow-xl"
      )}
    >
      {/* Top bar: back + "Post" */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-[var(--yrdly-glass-border)] bg-white/[0.03]"
      >
        <button onClick={handleBack} className="p-1 -ml-1 rounded hover:bg-accent text-[var(--yrdly-text-primary)]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-yrdly-display font-semibold text-sm leading-tight text-[var(--yrdly-text-primary)]">
          Post
        </span>
      </div>

      {/* Post header: avatar, name, time, tag */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div className="flex items-center gap-3 min-w-0">
          {loadingAuthor ? (
            <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
          ) : (
            <Avatar className="h-10 w-10 flex-shrink-0">
              <AvatarImage src={author?.avatar_url} />
              <AvatarFallback className="bg-[#82DB7E] text-[#050505] font-yrdly-display text-sm font-bold">{author?.name?.charAt(0) || "?"}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-1.5">
              <p className="font-yrdly-display font-bold text-sm text-[var(--yrdly-text-primary)] truncate">{author?.name || "Anonymous"}</p>
              {(author?.verified_seller || author?.is_verified || author?.phone_verified || author?.verified || (post.user as any)?.verified_seller || (post.user as any)?.is_verified || (post.user as any)?.phone_verified || (post.user as any)?.verified) && (
                <VerifiedBadge size={16} />
              )}
            </div>
            <p className="font-yrdly-body font-normal text-[0.6875rem] text-[var(--yrdly-label)]">
              {timeAgo(post.timestamp ? new Date(post.timestamp) : null)}
              {post.updated_at && (new Date(post.updated_at).getTime() - new Date(post.timestamp).getTime() > 2000) && " (edited)"}
            </p>
          </div>
        </div>
        <span
          className="flex-shrink-0 px-3 py-1 rounded-[12.5px] font-sans font-medium text-xs text-foreground"
          style={{ background: "var(--c-card2)" }}
        >
          {post.category}
        </span>
      </div>

      {/* Post body text */}
      <div className="px-4 pb-3">
        <p className="font-sans font-normal text-[0.8125rem] leading-[15px] text-foreground whitespace-pre-wrap">
          {post.text || ""}
        </p>
      </div>

      {/* Image Swiper Carousel — mirrors PostCard layout */}
      {urls.length > 0 && (
        <div className="px-3 pb-4">
          {urls.length === 1 ? (
            <div className="relative w-full overflow-hidden rounded-2xl" style={{ height: 360, maxHeight: 420 }}>
              <Image src={urls[0]} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 626px" />
            </div>
          ) : (
            <div className="relative group w-full overflow-hidden rounded-2xl" style={{ height: 360 }}>
              <div
                ref={carouselRef}
                onScroll={handleScroll}
                className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scroll-smooth"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {urls.map((u, i) => (
                  <div key={i} className="relative w-full h-full flex-shrink-0 snap-start">
                    <Image
                      src={u}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, 626px"
                    />
                  </div>
                ))}
              </div>

              {/* Prev / Next Chevrons */}
              {activeIndex > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    scrollToSlide(activeIndex - 1);
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-black/80"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}

              {activeIndex < urls.length - 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    scrollToSlide(activeIndex + 1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-black/80"
                  aria-label="Next image"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}

              {/* Slide Counter Badge */}
              <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/60 text-white z-10 pointer-events-none font-yrdly-body">
                {activeIndex + 1} / {urls.length}
              </div>

              {/* Dot Indicators */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm z-10 pointer-events-none">
                {urls.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-200",
                      i === activeIndex ? "w-4 bg-[#82DB7E]" : "w-1.5 bg-white/60"
                    )}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Video player */}
      {post.video_url && (
        <div className="px-3 pb-4">
          <div className="relative rounded-xl overflow-hidden bg-black">
            <video
              src={post.video_url.includes('#t=') ? post.video_url : `${post.video_url}#t=0.001`}
              controls
              playsInline
                disablePictureInPicture
                controlsList="nodownload noremoteplayback nopictureinpicture"
              preload="metadata"
              poster={post.video_thumbnail_url ?? undefined}
              className="w-full object-cover"
              style={{ borderRadius: 12, maxHeight: 400 }}
            />
          </div>
        </div>
      )}

      {/* Engagement row */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleLike}
              className="flex items-center justify-center w-11 h-11 p-2.5 rounded-lg bg-[#D9D9D9]/20 hover:bg-accent"
            >
              <Heart className={cn("w-5 h-5", isLiked && "fill-[#ED1111] text-[#ED1111]")} />
            </button>
            <span className="font-sans font-light italic text-xs text-foreground">{formatCount(likes)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MessageCircleMore className="w-5 h-5 text-foreground" />
            <span className="font-sans font-light text-xs text-foreground">{formatCount(commentCount)}</span>
          </div>
          <button onClick={handleShare} aria-label="Share post" className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-accent text-foreground">
            <Share2 className="w-5 h-5" />
          </button>
        </div>
        {currentUser?.id === post.user_id && (
          <AlertDialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="More options" className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-accent text-foreground">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border">
                {(() => {
                  const canEdit = (Date.now() - new Date(post.created_at || post.timestamp || Date.now()).getTime()) <= 15 * 60 * 1000;
                  if (!canEdit) return null;
                  
                  if (post.category === "Event") {
                    return (
                      <DropdownMenuItem onClick={() => router.push(`/events/${post.id}/manage`)} className="text-foreground focus:bg-accent cursor-pointer">
                        <Edit className="mr-2 h-4 w-4" /> Manage Event
                      </DropdownMenuItem>
                    );
                  }

                  if ((post as any).category === "For Sale" || (post as any).category === "Giveaway") {
                    return (
                      <DropdownMenuItem onClick={() => router.push(`/marketplace/edit/${post.id}`)} className="text-foreground focus:bg-accent cursor-pointer">
                        <Edit className="mr-2 h-4 w-4" /> Edit Listing
                      </DropdownMenuItem>
                    );
                  }

                  return null;
                })()}
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem className="text-red-400 focus:bg-red-500/10 focus:text-red-400">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialogContent className="bg-card border-border text-foreground">
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete your post and all comments.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-background/10 text-foreground border-0">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Comment input + CommentSection (inline, dark) */}
      <div className="border-t border-border">
        <CommentSection
          postId={post.id}
          post={post}
          author={author}
          onCommentCountChange={handleCommentCountChange}
          variant="inline"
          hidePostPreview
        />
      </div>
    </div>
  );
}