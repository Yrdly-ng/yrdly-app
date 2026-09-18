"use client";

import type { User, Post } from "@/types";
import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Heart,
  MessageCircleMore,
  Share2,
  Bookmark,
  MapPin,
  Calendar,
  MoreHorizontal,
  Trash2,
  Edit,
  Volume2,
  VolumeX,
  RotateCw,
  RotateCcw,
  Pause,
  Play,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "./ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogTrigger,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useToast } from "@/hooks/use-toast";
import { CommentSection } from "@/components/CommentSection";
import { timeAgo, formatPrice, cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/glass-card";

/* ─── design tokens ─────────────────────────────────────────────── */
const GREEN = "hsl(var(--primary))";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/* ─── Category tag chips ──────────────────────────────────────── */
function CategoryTag({ category }: { category: string }) {
  const label = category || "General";
  const styles: Record<string, string> = {
    General: "bg-[#E0F2FE] text-[#0284C7] border-[#BAE6FD] dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-900/60",
    Event: "bg-[#F3E8FF] text-[#7E22CE] border-[#E9D5FF] dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-900/60",
    "For Sale": "bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0] dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900/60",
  };
  const style = styles[label] || styles.General;
  return (
    <span className={`px-3 py-1 rounded-full font-yrdly-body font-semibold text-[0.75rem] leading-[14px] border ${style}`}>
      {label}
    </span>
  );
}

/* ─── interactive inline image swiper for feed posts ────────────── */
function ImageCollage({
  urls,
  onImageClick,
}: {
  urls: string[];
  onImageClick: (i: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  if (urls.length === 0) return null;

  if (urls.length === 1) {
    return (
      <div
        className="w-full cursor-pointer overflow-hidden relative rounded-yrdly-md bg-[var(--yrdly-glass-border)]/30"
        style={{ aspectRatio: "4/5", maxHeight: 480 }}
        onClick={(e) => {
          e.stopPropagation();
          onImageClick(0);
        }}
      >
        <Image
          src={urls[0]}
          alt=""
          fill
          aria-hidden="true"
          className="object-cover scale-110 blur-2xl brightness-75 pointer-events-none"
          sizes="48px"
          quality={10}
        />
        <Image
          src={urls[0]}
          alt="Post image"
          fill
          className="object-contain post-media-image"
          sizes="(max-width: 640px) 100vw, 626px"
        />
      </div>
    );
  }

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, clientWidth } = scrollRef.current;
    if (clientWidth > 0) {
      const idx = Math.round(scrollLeft / clientWidth);
      setActiveIndex(idx);
    }
  };

  const scrollToSlide = (idx: number) => {
    if (!scrollRef.current) return;
    const targetIdx = Math.max(0, Math.min(idx, urls.length - 1));
    const width = scrollRef.current.clientWidth;
    scrollRef.current.scrollTo({
      left: targetIdx * width,
      behavior: "smooth",
    });
    setActiveIndex(targetIdx);
  };

  return (
    <div
      className="relative w-full overflow-hidden rounded-yrdly-md group bg-[var(--yrdly-glass-border)]/30"
      style={{ aspectRatio: "4/5", maxHeight: 480 }}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide select-none"
      >
        {urls.map((url, i) => (
          <div
            key={i}
            className="relative flex-shrink-0 w-full h-full snap-center cursor-pointer"
            onPointerDown={(e) => {
              dragStartPos.current = { x: e.clientX, y: e.clientY };
            }}
            onClick={(e) => {
              e.stopPropagation();
              const start = dragStartPos.current;
              const moved = start
                ? Math.hypot(e.clientX - start.x, e.clientY - start.y)
                : 0;
              // Ignore the click if it was actually the end of a swipe/drag gesture.
              if (moved < 8) {
                onImageClick(i);
              }
            }}
          >
            <Image
              src={url}
              alt=""
              fill
              aria-hidden="true"
              loading="lazy"
              className="object-cover scale-110 blur-2xl brightness-75 pointer-events-none"
              sizes="48px"
              quality={10}
            />
            <Image
              src={url}
              alt={`Post image ${i + 1}`}
              fill
              className="object-contain post-media-image"
              sizes="(max-width: 640px) 100vw, 626px"
            />
          </div>
        ))}
      </div>

      {/* Prev / Next Chevrons on Desktop Hover */}
      {activeIndex > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            scrollToSlide(activeIndex - 1);
          }}
          className="yrdly-no-tap-scale absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-black/80"
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
          className="yrdly-no-tap-scale absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-black/80"
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
  );
}

/* ─── swipeable image carousel for the comments modal ───────────── */
function ModalImageCarousel({
  urls,
  initialIndex,
}: {
  urls: string[];
  initialIndex: number;
}) {
  const [activeIndex, setActiveIndex] = useState(
    Math.max(0, Math.min(initialIndex, urls.length - 1))
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScrollLeft = useRef(0);

  // Jump straight to the image the user actually tapped, without animating.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = activeIndex * scrollRef.current.clientWidth;
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, clientWidth } = scrollRef.current;
    if (clientWidth > 0) {
      setActiveIndex(Math.round(scrollLeft / clientWidth));
    }
  };

  const scrollToSlide = (idx: number) => {
    if (!scrollRef.current) return;
    const targetIdx = Math.max(0, Math.min(idx, urls.length - 1));
    const width = scrollRef.current.clientWidth;
    scrollRef.current.scrollTo({ left: targetIdx * width, behavior: "smooth" });
    setActiveIndex(targetIdx);
  };

  // Click-and-drag support so this feels swipeable with a mouse too (like IG web),
  // not just via touch. Native overflow-x scroll-snap already handles touch swipes.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return; // let native touch scrolling handle this
    if (!scrollRef.current) return;
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartScrollLeft.current = scrollRef.current.scrollLeft;
    scrollRef.current.style.scrollSnapType = "none";
    scrollRef.current.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !scrollRef.current) return;
    e.preventDefault();
    const delta = e.clientX - dragStartX.current;
    scrollRef.current.scrollLeft = dragStartScrollLeft.current - delta;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !scrollRef.current) return;
    isDragging.current = false;
    scrollRef.current.style.scrollSnapType = "";
    try {
      scrollRef.current.releasePointerCapture(e.pointerId);
    } catch {}
    const { scrollLeft, clientWidth } = scrollRef.current;
    const nearest = Math.round(scrollLeft / clientWidth);
    scrollToSlide(nearest);
  };

  return (
    <div className="relative w-full h-full overflow-hidden group">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide select-none cursor-grab active:cursor-grabbing"
      >
        {urls.map((url, i) => (
          <div key={i} className="relative flex-shrink-0 w-full h-full snap-center">
            <Image
              src={url}
              alt={`Post image ${i + 1}`}
              fill
              className="object-cover pointer-events-none"
              sizes="60vw"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {activeIndex > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            scrollToSlide(activeIndex - 1);
          }}
          className="yrdly-no-tap-scale absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-black/80"
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
          className="yrdly-no-tap-scale absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-black/80"
          aria-label="Next image"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/60 text-white z-10 pointer-events-none font-yrdly-body">
        {activeIndex + 1} / {urls.length}
      </div>

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
  );
}

/* ─── engagement row ─────────────────────────────────────────── */
function EngagementRow({
  likes,
  commentCount,
  isLiked,
  onLike,
  onComment,
  onShare,
  isBookmarked,
  onBookmark,
}: {
  likes: number;
  commentCount: number;
  isLiked: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  isBookmarked: boolean;
  onBookmark: () => void;
}) {
  const [animating, setAnimating] = useState(false);

  const handleLike = () => {
    setAnimating(true);
    setTimeout(() => setAnimating(false), 350);
    onLike();
  };

  return (
    <div className="flex items-center justify-between pt-yrdly-sm border-t border-[var(--yrdly-glass-border)]">
      <div className="flex items-center gap-1">
        {/* Likes */}
        <button
          onClick={handleLike}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full motion-snappy hover:bg-[var(--yrdly-glass-bg)] hover:scale-[0.97] active:scale-[0.95]"
        >
          <Heart
            className={`w-5 h-5 ${isLiked ? "text-[#ED1111]" : "text-[var(--yrdly-label)]"} ${
              animating ? "animate-heart-pop" : ""
            }`}
            style={{
              fill: isLiked ? "#ED1111" : "transparent",
            }}
          />
          <span className="text-[0.75rem] font-medium text-[var(--yrdly-label)] font-yrdly-body">
            {fmt(likes)}
          </span>
        </button>
        {/* Comments */}
        <button
          onClick={onComment}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full motion-snappy hover:bg-[var(--yrdly-glass-bg)] hover:scale-[0.97] active:scale-[0.95]"
        >
          <MessageCircleMore className="w-5 h-5 text-[var(--yrdly-label)]" />
          <span className="text-[0.75rem] font-medium text-[var(--yrdly-label)] font-yrdly-body">
            {fmt(commentCount)}
          </span>
        </button>
        {/* Share */}
        <button
          onClick={onShare}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full motion-snappy hover:bg-[var(--yrdly-glass-bg)] hover:scale-[0.97] active:scale-[0.95]"
        >
          <Share2 className="w-5 h-5 text-[var(--yrdly-label)]" />
        </button>
        {/* Bookmark */}
        <button
          onClick={onBookmark}
          aria-label={isBookmarked ? "Remove bookmark" : "Bookmark post"}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full motion-snappy hover:bg-[var(--yrdly-glass-bg)] hover:scale-[0.97] active:scale-[0.95]"
        >
          <Bookmark
            className={cn(
              "w-5 h-5 transition-colors",
              isBookmarked ? "text-primary" : "text-[var(--yrdly-label)]"
            )}
            style={{ fill: isBookmarked ? "currentColor" : "transparent" }}
          />
        </button>
      </div>
    </div>
  );
}

/* ─── main PostCard ─────────────────────────────────────────────── */
interface PostCardProps {
  post: Post;
  onDelete?: (postId: string) => void;
  onCreatePost?: (postData: any, postId?: string, imageFiles?: FileList) => Promise<void>;
}

export function PostCard({ post, onDelete, onCreatePost }: PostCardProps) {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [author, setAuthor] = useState<User | null>(null);
  const [loadingAuthor, setLoadingAuthor] = useState(true);
  const [likes, setLikes] = useState(post.liked_by?.length || 0);
  const [commentCount, setCommentCount] = useState(post.comment_count || 0);
  const [isLiked, setIsLiked] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isEventEditDialogOpen, setIsEventEditDialogOpen] = useState(false);
  const [isTextExpanded, setIsTextExpanded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [videoProgress, setVideoProgress] = useState(0);
  const [isVideoMuted, setIsVideoMuted] = useState(true);
  const [isVideoPaused, setIsVideoPaused] = useState(false);
  const [seekFlash, setSeekFlash] = useState<"back" | "forward" | null>(null);
  const seekFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeVideoUrl = post.video_url || ((post as any).video_urls && (post as any).video_urls[0]) || null;

  /* ── auto-pause video when scrolled out of view ── */
  useEffect(() => {
    if (!videoRef.current || !activeVideoUrl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting && !videoRef.current?.paused) {
            videoRef.current?.pause();
          } else if (entry.isIntersecting && videoRef.current?.paused && !isVideoPaused) {
            document.querySelectorAll('video').forEach(v => {
              if (v !== videoRef.current && !v.paused) v.pause();
            });
            videoRef.current?.play().catch(e => console.log('Autoplay prevented:', e));
          }
        });
      },
      { threshold: 0.6 }
    );
    
    observer.observe(videoRef.current);
    return () => observer.disconnect();
  }, [activeVideoUrl, isVideoPaused]);

  useEffect(() => {
    return () => {
      if (seekFlashTimeoutRef.current) clearTimeout(seekFlashTimeoutRef.current);
    };
  }, []);

  const handleVideoTap = (e: React.MouseEvent<HTMLVideoElement>) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const tapX = e.clientX - rect.left;
    const ratio = rect.width > 0 ? tapX / rect.width : 0.5;

    const flashSeek = (direction: "back" | "forward") => {
      if (seekFlashTimeoutRef.current) clearTimeout(seekFlashTimeoutRef.current);
      setSeekFlash(direction);
      seekFlashTimeoutRef.current = setTimeout(() => setSeekFlash(null), 600);
    };

    if (ratio < 0.35) {
      video.currentTime = Math.max(video.currentTime - 5, 0);
      flashSeek("back");
    } else if (ratio > 0.65) {
      video.currentTime = Math.min(video.currentTime + 5, video.duration || video.currentTime + 5);
      flashSeek("forward");
    } else {
      if (video.paused) {
        video.play().catch(() => {});
        setIsVideoPaused(false);
      } else {
        video.pause();
        setIsVideoPaused(true);
      }
    }
  };

  /* ── fetch author ── */
  useEffect(() => {
    const fetch = async () => {
      if (!post.user_id) {
        setAuthor({ id: "unknown", uid: "unknown", name: post.author_name || "Anonymous", avatar_url: post.author_image || "https://placehold.co/100x100.png", timestamp: post.timestamp });
        setLoadingAuthor(false);
        return;
      }
      try {
        setLoadingAuthor(true);
        if (post.user) {
          setAuthor({ id: post.user_id, uid: post.user_id, name: post.user.name || post.author_name || "Anonymous", avatar_url: post.user.avatar_url || post.author_image || "https://placehold.co/100x100.png", timestamp: (post.user as any).created_at || post.timestamp, verified_seller: (post.user as any).verified_seller, is_verified: (post.user as any).is_verified, phone_verified: (post.user as any).phone_verified } as any);
          setLoadingAuthor(false);
        } else {
          const { data, error } = await supabase.from("users").select("id, name, avatar_url, created_at, verified_seller, phone_verified").eq("id", post.user_id).single();
          setAuthor(error
            ? { id: post.user_id, uid: post.user_id, name: post.author_name || "Anonymous", avatar_url: post.author_image || "https://placehold.co/100x100.png", timestamp: post.timestamp }
            : { id: data.id, uid: data.id, name: data.name || "Anonymous", avatar_url: data.avatar_url || "https://placehold.co/100x100.png", timestamp: data.created_at || post.timestamp, verified_seller: data.verified_seller, is_verified: (data as any).is_verified || false, phone_verified: data.phone_verified } as any
          );
          setLoadingAuthor(false);
        }
      } catch {
        setAuthor({ id: post.user_id, uid: post.user_id, name: post.author_name || "Anonymous", avatar_url: post.author_image || "https://placehold.co/100x100.png", timestamp: post.timestamp });
        setLoadingAuthor(false);
      }
    };
    fetch();
  }, [post.user_id, post.user, post.timestamp, post.author_image, post.author_name]);

  /* ── realtime post updates ── */
  useEffect(() => {
    if (!post.id) return;
    setLikes(post.liked_by?.length || 0);
    setCommentCount(post.comment_count || 0);
    if (currentUser && post.liked_by) setIsLiked(post.liked_by.includes(currentUser.id));
    const ch = supabase.channel(`post-${post.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `id=eq.${post.id}` }, (payload) => {
        if (payload.new) {
          const p = payload.new as any;
          setLikes(p.liked_by?.length || 0);
          setCommentCount(p.comment_count || 0);
          if (currentUser && p.liked_by) setIsLiked(p.liked_by.includes(currentUser.id));
        }
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [post.id, post.liked_by, post.comment_count, currentUser]);

  /* ── bookmark state ── */
  useEffect(() => {
    if (!currentUser || !post.id) return;
    supabase
      .from("post_bookmarks")
      .select("id")
      .eq("post_id", post.id)
      .eq("user_id", currentUser.id)
      .maybeSingle()
      .then(({ data }) => setIsBookmarked(!!data));
  }, [currentUser, post.id]);

  const handleBookmarkToggle = async () => {
    if (!currentUser || !post.id) return;
    const newBookmarked = !isBookmarked;
    setIsBookmarked(newBookmarked);

    if (newBookmarked) {
      const { error } = await supabase
        .from("post_bookmarks")
        .insert({ post_id: post.id, user_id: currentUser.id });
      if (error) {
        setIsBookmarked(false);
        if (error.code !== "23505") {
          toast({ variant: "destructive", title: "Error", description: "Could not save post." });
        }
      }
    } else {
      const { error } = await supabase
        .from("post_bookmarks")
        .delete()
        .match({ post_id: post.id, user_id: currentUser.id });
      if (error) {
        setIsBookmarked(true);
        toast({ variant: "destructive", title: "Error", description: "Could not remove bookmark." });
      }
    }
  };

  const handleLike = async () => {
    if (!currentUser || !post.id) return;
    const previousIsLiked = isLiked;
    const previousLikes = likes;

    const nextIsLiked = !previousIsLiked;
    setIsLiked(nextIsLiked);
    setLikes(nextIsLiked ? previousLikes + 1 : Math.max(0, previousLikes - 1));

    try {
      const { data, error } = await supabase.rpc("toggle_post_like", {
        p_post_id: post.id,
        p_user_id: currentUser.id,
      });

      if (error) throw error;

      if (data) {
        setIsLiked(data.is_liked);
        setLikes(data.likes_count);
      }

      if (nextIsLiked) {
        try { const { NotificationTriggers } = await import("@/lib/notification-triggers"); await NotificationTriggers.onPostLiked(post.id, currentUser.id); } catch {}
      } else {
        try { const { NotificationTriggers } = await import("@/lib/notification-triggers"); await NotificationTriggers.onPostUnliked(post.id, currentUser.id); } catch {}
      }
    } catch {
      setIsLiked(previousIsLiked);
      setLikes(previousLikes);
      toast({ variant: "destructive", title: "Error", description: "Failed to update like." });
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/posts/${post.id}`;
    const imageUrls = post.image_urls?.length ? post.image_urls : post.image_url ? [post.image_url] : [];
    const imageUrl = imageUrls[0];

    if (navigator.share) {
      try {
        if (imageUrl && navigator.canShare) {
          try {
            const resp = await fetch(imageUrl);
            const blob = await resp.blob();
            const ext = blob.type.split("/")[1] || "jpg";
            const file = new File([blob], `yrdly-post.${ext}`, { type: blob.type });
            const shareData = {
              title: post.title || "Post on Yrdly",
              text: post.text ? post.text.slice(0, 100) : "",
              url,
              files: [file],
            };
            if (navigator.canShare(shareData)) {
              await navigator.share(shareData);
              return;
            }
          } catch {}
        }
        await navigator.share({
          title: post.title || "Post on Yrdly",
          text: post.text ? post.text.slice(0, 100) : "",
          url,
        });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: "Link copied!", description: "Post link copied to clipboard." });
      } catch {
        toast({ variant: "destructive", title: "Error", description: "Could not copy link." });
      }
    }
  };

  const handleDelete = async () => {
    if (!currentUser || !post.id || currentUser.id !== post.user_id) return;
    try {
      const { error } = await supabase.from("posts").delete().eq("id", post.id);
      if (error) { toast({ variant: "destructive", title: "Error", description: "Failed to delete post." }); return; }
      await supabase.from("comments").delete().eq("post_id", post.id);
      toast({ title: "Post deleted" });
      if (onDelete) await onDelete(post.id);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete post." });
    }
  };

  const handleMessageSeller = async () => {
    if (!currentUser || !author || currentUser.id === author.id) return;
    const sortedIds = [currentUser.id, author.id].sort();
    try {
      if (post.category === "For Sale") {
        const { data: existing } = await supabase.from("conversations").select("id").contains("participant_ids", [currentUser.id]).eq("type", "marketplace").eq("item_id", post.id);
        let cid: string;
        if (existing && existing.length > 0) {
          cid = existing[0].id;
        } else {
          const { data: nc } = await supabase.from("conversations").insert({ participant_ids: sortedIds, type: "marketplace", item_id: post.id, item_title: post.text || "Item", item_image: post.image_url || post.image_urls?.[0] || "", item_price: post.price || 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select("id").single();
          if (!nc) { toast({ variant: "destructive", title: "Error", description: "Could not create conversation." }); return; }
          cid = nc.id;
        }
        router.push(`/messages/${cid}`);
      } else {
        const { data: all } = await supabase.from("conversations").select("id, participant_ids").contains("participant_ids", [currentUser.id]);
        const existing = all?.filter((c) => c.participant_ids.includes(author.id) && c.participant_ids.length === 2);
        let cid: string;
        if (existing && existing.length > 0) {
          cid = existing[0].id;
        } else {
          const { data: nc } = await supabase.from("conversations").insert({ participant_ids: sortedIds, created_at: new Date().toISOString() }).select("id").single();
          if (!nc) { toast({ variant: "destructive", title: "Error", description: "Could not create conversation." }); return; }
          cid = nc.id;
        }
        router.push(`/messages/${cid}`);
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not open conversation." });
    }
  };

  const openProfile = () => {
    if (author && author.id !== currentUser?.id) router.push(`/profile/${author.id}`);
  };

  // Shared destination logic so tapping the post body and tapping a photo
  // always land in the same place.
  const goToPostDestination = () => {
    if (post.category === "For Sale") {
      router.push(`/marketplace/${post.id}`);
      return;
    }
    if (post.category === "Event" && post.event_link) {
      const cleanLink = post.event_link.split('?')[0];
      const parts = cleanLink.split('/');
      const eventId = parts.pop() || parts.pop();
      if (eventId) {
        router.push(`/events/${eventId}`);
        return;
      }
    }
    setIsCommentsOpen(true);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, [role="dialog"], [role="menu"]')) return;
    if (window.getSelection()?.toString()) return;
    if (!isCommentsOpen) {
      goToPostDestination();
    }
  };

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index);
    goToPostDestination();
  };

  const getEventDate = () => {
    if (!post.event_date) return "";
    try {
      return new Date(post.event_date).toLocaleDateString("en-GB", { hour: "2-digit", minute: "2-digit", weekday: "short", month: "short", day: "numeric" });
    } catch { return ""; }
  };

  const getLocation = (loc: unknown): string => {
    if (!loc || typeof loc !== "object") return "";
    const o = loc as Record<string, unknown>;
    if (typeof o.address === "string") return o.address;
    return "";
  };

  const urls = post.image_urls?.length ? post.image_urls : post.image_url ? [post.image_url] : [];

  /* ── post header ── */
  const PostHeader = (
    <div className="flex items-start justify-between gap-2 px-yrdly-md pt-yrdly-md pb-yrdly-sm">
      <div className="flex items-center gap-3 min-w-0">
        {loadingAuthor ? (
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0 bg-[var(--yrdly-glass-bg)]" />
        ) : (
          <button onClick={openProfile} className="flex-shrink-0">
            <Avatar className="h-10 w-10">
              <AvatarImage src={author?.avatar_url} />
              <AvatarFallback className="text-xs text-foreground font-yrdly-body" style={{ background: GREEN }}>{author?.name?.charAt(0) || "?"}</AvatarFallback>
            </Avatar>
          </button>
        )}
        {loadingAuthor ? (
          <div className="space-y-1">
            <Skeleton className="h-3 w-24 bg-[var(--yrdly-glass-bg)]" />
            <Skeleton className="h-2 w-16 bg-[var(--yrdly-glass-bg)]" />
          </div>
        ) : (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={openProfile} className="flex items-center gap-1">
                <span className="font-yrdly-display font-bold text-[0.875rem] text-foreground hover:underline">{author?.name || "Anonymous"}</span>
                {(author?.verified_seller || (author as any)?.is_verified || (author as any)?.phone_verified || (post.user as any)?.verified_seller || (post.user as any)?.is_verified || (post.user as any)?.phone_verified) && (
                  <VerifiedBadge size={16} type={(author?.verified_seller || (post.user as any)?.verified_seller) ? "seller" : "user"} />
                )}
              </button>
              <span className="text-[var(--yrdly-label)] text-[0.6875rem]">•</span>
              <span className="font-yrdly-body font-normal text-[0.6875rem] text-[var(--yrdly-label)]">
                {timeAgo(post.timestamp ? new Date(post.timestamp) : null)}
              </span>
              {post.updated_at && (new Date(post.updated_at).getTime() - new Date(post.timestamp).getTime() > 2000) && (
                <>
                  <span className="text-[var(--yrdly-label)] text-[0.6875rem]">•</span>
                  <span className="font-yrdly-body font-normal text-[0.6875rem] text-[var(--yrdly-label)]">edited</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <CategoryTag category={post.category} />
        {currentUser?.id === post.user_id && (
          <AlertDialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-2 -m-2 rounded hover:bg-accent text-[var(--yrdly-label)] hover:text-foreground">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border font-yrdly-body">
                {(() => {
                  const canEdit = (Date.now() - new Date(post.created_at || post.timestamp || Date.now()).getTime()) <= 15 * 60 * 1000;
                  if (!canEdit) return null;
                  
                  if (post.category === "Event") {
                    return (
                      <DropdownMenuItem onClick={() => router.push(`/events/${post.id}/manage`)} className="focus:bg-accent cursor-pointer">
                        <Edit className="mr-2 h-4 w-4" /> Manage Event
                      </DropdownMenuItem>
                    );
                  }

                  if ((post as any).category === "For Sale" || (post as any).category === "Giveaway") {
                    return (
                      <DropdownMenuItem onClick={() => router.push(`/marketplace/edit/${post.id}`)} className="focus:bg-accent cursor-pointer">
                        <Edit className="mr-2 h-4 w-4" /> Edit Listing
                      </DropdownMenuItem>
                    );
                  }

                  return null;
                })()}
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-red-400 focus:text-red-400 focus:bg-red-500/10">
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialogContent className="bg-card border-border font-yrdly-body">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-yrdly-display">Delete post?</AlertDialogTitle>
                <AlertDialogDescription className="font-yrdly-body">This will permanently delete your post and all its comments.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-muted border-0 font-yrdly-body">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700 font-yrdly-body">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );

  /* ── card content by type ── */
  let cardContent: React.ReactNode;

  if (post.category === "Event") {
    cardContent = (
      <>
        {PostHeader}
        {/* Title above image */}
        {(post.title || post.text) && (
          <p className="px-yrdly-md pb-yrdly-xs font-yrdly-display font-bold text-[1.125rem] text-foreground leading-[21px]">
            {post.title || post.text?.split("\n")[0]}
          </p>
        )}
        {/* image */}
        {urls.length > 0 && (
          <div className="px-yrdly-sm pb-yrdly-sm">
            <ImageCollage urls={urls} onImageClick={handleImageClick} />
          </div>
        )}
        {/* Description text */}
        {post.text && post.title && (
          <p className="px-yrdly-md pb-yrdly-xs font-yrdly-body font-normal text-[0.8125rem] text-[var(--yrdly-label)] leading-[15px]">{post.text}</p>
        )}
        {/* Event meta */}
        <div className="px-yrdly-md pb-yrdly-sm space-y-2 font-yrdly-body">
          {post.event_date && (
            <div className="flex items-center gap-2 text-[var(--yrdly-label)]">
              <Calendar className="w-5 h-5 flex-shrink-0" />
              <span className="font-yrdly-body font-normal text-[0.8125rem]">{getEventDate()}</span>
            </div>
          )}
          {post.event_location && (
            <div className="flex items-center gap-2 text-[var(--yrdly-label)]">
              <MapPin className="w-5 h-5 flex-shrink-0" />
              <span className="font-yrdly-body font-normal text-[0.8125rem]">{getLocation(post.event_location)}</span>
            </div>
          )}
        </div>
        {/* Price + share */}
        {post.price != null && post.price > 0 && (
          <div className="flex items-center justify-between px-yrdly-md pb-yrdly-sm">
            <span className="font-yrdly-display font-bold text-[1.5rem] leading-[28px] text-primary">
              {formatPrice(post.price)}
            </span>
            <button onClick={handleShare} className="text-[var(--yrdly-label)] hover:text-foreground">
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        )}
      </>
    );
  } else if (post.category === "For Sale") {
    const itemTitle = post.title || post.text?.split("\n")[0] || "Item";
    const desc = post.description || (post.title ? post.text : undefined);
    cardContent = (
      <>
        {PostHeader}
        {/* Item name */}
        <p className="px-yrdly-md pb-yrdly-xs font-yrdly-display font-semibold text-[1.125rem] text-foreground leading-[21px]">{itemTitle}</p>
        {/* image */}
        {urls.length > 0 && (
          <div className="px-yrdly-sm pb-yrdly-sm">
            <div className="relative w-full overflow-hidden rounded-yrdly-md" style={{ aspectRatio: "4/5", maxHeight: 480 }}>
              <Image src={urls[0]} alt="" fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover post-media-image" />
            </div>
          </div>
        )}
        {/* Price */}
        <p className="px-yrdly-md pb-1 font-yrdly-display font-bold text-[1.5rem] leading-[28px] text-primary">
          {post.price ? formatPrice(post.price) : "Free"}
        </p>
        {/* Description / subtitle */}
        {desc && (
          <p className="px-yrdly-md pb-yrdly-sm font-yrdly-body font-normal text-[0.8125rem] text-[var(--yrdly-label)] leading-[15px]">{desc}</p>
        )}
        {/* Message seller */}
        <div className="flex items-center justify-between px-yrdly-md pb-yrdly-sm gap-2">
          <div
            className="flex-1 flex items-center rounded-full overflow-hidden h-10 gap-2 px-4 border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-md"
          >
            <Avatar className="h-6 w-6 flex-shrink-0">
              <AvatarImage src={author?.avatar_url} />
              <AvatarFallback className="text-[0.5625rem] text-foreground font-yrdly-body" style={{ background: GREEN }}>{author?.name?.charAt(0)}</AvatarFallback>
            </Avatar>
            <button
              onClick={handleMessageSeller}
              className="flex-1 text-left font-yrdly-body italic font-extralight text-[0.625rem] text-[var(--yrdly-label)]"
            >
              {currentUser?.id === author?.id ? "Your listing" : "Send seller a message"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleShare} className="text-[var(--yrdly-label)] hover:text-foreground">
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </>
    );
  } else {
    // General post
    const text = post.text || "";
    const maxLength = 180;
    const shouldTruncate = text.length > maxLength;
    const displayText = isTextExpanded || !shouldTruncate ? text : text.slice(0, maxLength) + "…";

    cardContent = (
      <>
        {PostHeader}
        {/* Body text */}
        {text && (
          <div className="px-yrdly-md pb-yrdly-sm">
            <p className="font-yrdly-body font-normal text-[0.8125rem] leading-[15px] text-foreground whitespace-pre-wrap">
              {displayText}
              {shouldTruncate && (
                <button
                  onClick={(e) => { e.stopPropagation(); setIsTextExpanded(!isTextExpanded); }}
                  className="ml-1 font-yrdly-body font-medium text-[0.75rem] text-[var(--yrdly-label)] hover:text-primary"
                >
                  {isTextExpanded ? "see less" : "see more"}
                </button>
              )}
            </p>
          </div>
        )}
        {/* Images */}
        {urls.length > 0 && (
          <div className="px-yrdly-sm pb-yrdly-sm">
            <ImageCollage urls={urls} onImageClick={handleImageClick} />
          </div>
        )}
        {/* Video player */}
        {activeVideoUrl && (
          <div className="px-yrdly-sm pb-yrdly-sm">
            <div className="relative rounded-yrdly-md overflow-hidden bg-black">
              <video
                ref={videoRef}
                src={activeVideoUrl.includes('#t=') ? activeVideoUrl : `${activeVideoUrl}#t=0.001`}
                playsInline
                disablePictureInPicture
                controlsList="nodownload noremoteplayback nopictureinpicture"
                muted={isVideoMuted}
                loop
                preload="metadata"
                poster={post.video_thumbnail_url ?? undefined}
                className="w-full object-cover post-media-image"
                style={{ aspectRatio: "4/5", maxHeight: 480 }}
                onTimeUpdate={() => {
                  if (videoRef.current) {
                    const progress = (videoRef.current.currentTime / videoRef.current.duration) * 100;
                    setVideoProgress(progress || 0);
                  }
                }}
                onClick={handleVideoTap}
              />

              {/* Tap-to-pause overlay icon */}
              {isVideoPaused && !seekFlash && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/40 rounded-full p-3">
                    <Play className="w-7 h-7 text-white fill-white" />
                  </div>
                </div>
              )}

              {/* Seek flash */}
              {seekFlash && (
                <div
                  className={`absolute inset-y-0 ${seekFlash === "back" ? "left-0" : "right-0"} w-1/3 flex items-center justify-center pointer-events-none`}
                >
                  <div className="flex flex-col items-center gap-1 bg-black/50 rounded-full px-3 py-3 animate-in fade-in zoom-in duration-150">
                    {seekFlash === "back" ? (
                      <RotateCcw className="w-5 h-5 text-white" />
                    ) : (
                      <RotateCw className="w-5 h-5 text-white" />
                    )}
                    <span className="text-[0.625rem] font-medium text-white font-yrdly-body">5s</span>
                  </div>
                </div>
              )}

              {/* Mute / unmute */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsVideoMuted((prev) => !prev);
                }}
                aria-label={isVideoMuted ? "Unmute video" : "Mute video"}
                className="absolute bottom-3 right-3 z-10 flex items-center justify-center bg-black/50 hover:bg-black/70 transition-colors rounded-full w-8 h-8"
              >
                {isVideoMuted ? (
                  <VolumeX className="w-4 h-4 text-white" />
                ) : (
                  <Volume2 className="w-4 h-4 text-white" />
                )}
              </button>

              {/* Custom Thin Progress Bar */}
              <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/30 z-10">
                <div 
                  className="h-full bg-white/90 transition-all duration-75 ease-linear"
                  style={{ width: `${videoProgress}%` }}
                />
              </div>
            </div>
          </div>
        )}
        {/* Engagement */}
        <div className="px-yrdly-md pb-yrdly-md pt-yrdly-xs">
          <EngagementRow
            likes={likes}
            commentCount={commentCount}
            isLiked={isLiked}
            onLike={handleLike}
            onComment={() => setIsCommentsOpen(true)}
            onShare={handleShare}
            isBookmarked={isBookmarked}
            onBookmark={handleBookmarkToggle}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <GlassCard
        className="w-full mb-4 cursor-pointer motion-snappy p-0 overflow-hidden"
        onClick={handleCardClick}
      >
        {cardContent}
      </GlassCard>

      {/* Comments — Instagram-style modal (image left, comments right on wide screens) */}
      {isCommentsOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-end md:items-center justify-center p-0 md:p-6"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setIsCommentsOpen(false)}
        >
          <button
            onClick={() => setIsCommentsOpen(false)}
            className="absolute top-3 right-3 md:top-5 md:right-5 z-10 flex items-center justify-center w-9 h-9 rounded-full text-white hover:bg-white/10"
            aria-label="Close comments"
          >
            <X className="w-5 h-5" />
          </button>

          <div
            className="w-full md:h-[min(90vh,700px)] md:max-w-[935px] md:rounded-xl overflow-hidden flex flex-col md:flex-row bg-background border border-[var(--yrdly-glass-border)] rounded-t-[24px]"
            style={{ height: 'calc(100dvh - env(safe-area-inset-top, 0px) - 24px)', maxHeight: '92dvh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left — image, video, or (if text-only) the post's own writing, like Instagram's own comments screen */}
            {(urls.length > 0 || activeVideoUrl) ? (
              <div className="hidden md:block relative flex-1 min-w-0 h-full bg-black overflow-hidden">
                {activeVideoUrl ? (
                  <video
                    src={activeVideoUrl.includes("#t=") ? activeVideoUrl : `${activeVideoUrl}#t=0.001`}
                    controls
                    playsInline
                    preload="metadata"
                    poster={post.video_thumbnail_url ?? undefined}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : urls.length > 1 ? (
                  <ModalImageCarousel urls={urls} initialIndex={selectedImageIndex} />
                ) : (
                  <Image
                    src={urls[0]}
                    alt="Post image"
                    fill
                    className="object-cover"
                    sizes="60vw"
                  />
                )}
              </div>
            ) : (
              <div className="hidden md:flex flex-1 min-w-0 h-full bg-[var(--yrdly-glass-bg)] overflow-hidden flex-col p-10 justify-center">
                <div className="flex items-center gap-3 mb-5">
                  <Avatar className="h-11 w-11 flex-shrink-0">
                    <AvatarImage src={author?.avatar_url} />
                    <AvatarFallback className="bg-[#82DB7E] text-[#050505] font-bold">
                      {author?.name?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-yrdly-display font-bold text-sm text-foreground truncate">
                      {author?.name || "Anonymous"}
                    </p>
                    {post.category && (
                      <span
                        className="inline-block mt-0.5 px-2.5 py-0.5 rounded-full font-sans font-medium text-[0.6875rem] text-foreground"
                        style={{ background: "var(--c-card2)" }}
                      >
                        {post.category}
                      </span>
                    )}
                  </div>
                </div>
                <p className="font-sans text-2xl leading-snug text-foreground whitespace-pre-wrap break-words max-h-[70%] overflow-y-auto">
                  {post.text}
                </p>
              </div>
            )}

            {/* Right — header + comments + input */}
            <div className="w-full md:w-[400px] flex-shrink-0 flex flex-col min-h-0 h-full border-l border-[var(--yrdly-glass-border)] bg-background">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--yrdly-glass-border)] flex-shrink-0">
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarImage src={author?.avatar_url} />
                  <AvatarFallback className="bg-[#82DB7E] text-[#050505] text-xs font-bold">
                    {author?.name?.charAt(0) || "?"}
                  </AvatarFallback>
                </Avatar>
                <span className="font-yrdly-display font-bold text-sm text-foreground truncate">
                  {author?.name || "Anonymous"}
                </span>
              </div>

              <div className="flex-1 min-h-0 flex flex-col">
                <CommentSection
                  postId={post.id}
                  post={post}
                  author={author}
                  onCommentCountChange={setCommentCount}
                  onClose={() => setIsCommentsOpen(false)}
                  hidePostPreview
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}