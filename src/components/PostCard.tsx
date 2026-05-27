
"use client";

import type { User, Post } from "@/types";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Heart,
  MessageCircle,
  Share2,
  MapPin,
  Calendar,
  MoreHorizontal,
  Trash2,
  Edit,
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
import { CreatePostDialog } from "./CreatePostDialog";
import { CreateEventDialog } from "./CreateEventDialog";
import { useToast } from "@/hooks/use-toast";
import { CommentSection } from "./CommentSection";
import { timeAgo, formatPrice } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { ImageSwiper } from "./ImageSwiper";

/* ─── design tokens ─────────────────────────────────────────────── */
const CARD_BG = "var(--c-card)";
const BG = "var(--c-bg)";
const GREEN = "#388E3C";
const FONT_RALEWAY = "Inter, sans-serif";
const FONT_PACIFICO = "Pacifico, cursive";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/* ─── Category tag chips ──────────────────────────────────────── */
function CategoryTag({ category }: { category: string }) {
  if (category === "Event") {
    return (
      <span
        className="px-3 py-1 rounded-[12.5px] font-sans font-medium text-[0.75rem] leading-[14px]"
        style={{ background: "var(--c-bg)", border: "1px solid #983412", color: "#EBD598" }}
      >
        Event
      </span>
    );
  }
  if (category === "For Sale") {
    return (
      <span
        className="px-3 py-1 rounded-[12.5px] font-sans font-medium text-[0.75rem] leading-[14px]"
        style={{ background: "var(--c-bg)", border: `1px solid ${GREEN}`, color: "#BBF7D0" }}
      >
        For Sale
      </span>
    );
  }
  // General / default
  return (
    <span
      className="px-3 py-1 rounded-[12.5px] font-sans font-medium text-[0.75rem] leading-[14px] text-foreground"
      style={{ background: "var(--c-card2)" }}
    >
      {category || "General"}
    </span>
  );
}

/* ─── image collage (1 tall-left + 2 stacked-right) ────────────── */
function ImageCollage({
  urls,
  onImageClick,
}: {
  urls: string[];
  onImageClick: (i: number) => void;
}) {
  if (urls.length === 0) return null;

  if (urls.length === 1) {
    return (
      <div
        className="relative w-full cursor-pointer overflow-hidden"
        style={{ borderRadius: 12, height: 320, maxHeight: 320 }}
        onClick={() => onImageClick(0)}
      >
        <Image
          src={urls[0]}
          alt="Post image"
          fill
          className="object-cover"
          sizes="(max-width: 640px) 100vw, 626px"
        />
      </div>
    );
  }

  // 2 images: equal side-by-side at fixed height
  if (urls.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-0.5 overflow-hidden" style={{ borderRadius: 12, height: 240 }}>
        {urls.map((u, i) => (
          <div key={i} className="relative cursor-pointer h-full" onClick={() => onImageClick(i)}>
            <Image src={u} alt="" fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover" />
          </div>
        ))}
      </div>
    );
  }

  // 3+: 1 tall left + 2 right stacked (Nextdoor style)
  return (
    <div className="grid grid-cols-2 gap-0.5 overflow-hidden" style={{ borderRadius: 12, height: 260 }}>
      <div className="relative row-span-2 cursor-pointer h-full" onClick={() => onImageClick(0)}>
        <Image src={urls[0]} alt="" fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover" />
      </div>
      <div className="relative cursor-pointer" onClick={() => onImageClick(1)}>
        <Image src={urls[1]} alt="" fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover" />
      </div>
      <div className="relative cursor-pointer" onClick={() => onImageClick(2)}>
        <Image src={urls[2]} alt="" fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover" />
        {urls.length > 3 && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-white font-semibold text-base font-sans">+{urls.length - 3}</span>
          </div>
        )}
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
}: {
  likes: number;
  commentCount: number;
  isLiked: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* Likes */}
        <div className="flex items-center gap-1.5">
          <button onClick={onLike} className="flex items-center">
            <Heart
              className={`w-5 h-5 ${isLiked ? "text-[#ED1111]" : "text-muted-foreground"}`}
              style={{
                fill: isLiked ? "#ED1111" : "transparent",
              }}
            />
          </button>
          <span className="text-[0.75rem] font-light text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>
            {fmt(likes)}
          </span>
        </div>
        {/* dot */}
        <div className="w-[2px] h-[2px] rounded-full bg-muted-foreground" />
        {/* Comments */}
        <div className="flex items-center gap-1.5">
          <button onClick={onComment}>
            <MessageCircle className="w-5 h-5 text-muted-foreground" />
          </button>
          <span className="text-[0.75rem] font-light text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>
            {fmt(commentCount)}
          </span>
        </div>
        {/* dot */}
        <div className="w-[2px] h-[2px] rounded-full bg-muted-foreground" />
        {/* Share */}
        <button onClick={onShare}>
          <Share2 className="w-5 h-5 text-muted-foreground" />
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
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isImageSwiperOpen, setIsImageSwiperOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isEventEditDialogOpen, setIsEventEditDialogOpen] = useState(false);
  const [isTextExpanded, setIsTextExpanded] = useState(false);

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
          setAuthor({ id: post.user_id, uid: post.user_id, name: post.user.name || post.author_name || "Anonymous", avatar_url: post.user.avatar_url || post.author_image || "https://placehold.co/100x100.png", timestamp: (post.user as any).created_at || post.timestamp });
          setLoadingAuthor(false);
        } else {
          const { data, error } = await supabase.from("users").select("id, name, avatar_url, created_at").eq("id", post.user_id).single();
          setAuthor(error
            ? { id: post.user_id, uid: post.user_id, name: post.author_name || "Anonymous", avatar_url: post.author_image || "https://placehold.co/100x100.png", timestamp: post.timestamp }
            : { id: data.id, uid: data.id, name: data.name || "Anonymous", avatar_url: data.avatar_url || "https://placehold.co/100x100.png", timestamp: data.created_at || post.timestamp }
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

  const handleLike = async () => {
    if (!currentUser || !post.id) return;
    try {
      const { data: pd } = await supabase.from("posts").select("liked_by").eq("id", post.id).single();
      const current = (pd?.liked_by || []) as string[];
      const hasLiked = current.includes(currentUser.id);
      const next = hasLiked ? current.filter((id) => id !== currentUser.id) : [...current, currentUser.id];
      await supabase.from("posts").update({ liked_by: next }).eq("id", post.id);
      setLikes(next.length);
      setIsLiked(!hasLiked);
      if (!hasLiked) {
        try { const { NotificationTriggers } = await import("@/lib/notification-triggers"); await NotificationTriggers.onPostLiked(post.id, currentUser.id); } catch {}
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to like post." });
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/posts/${post.id}`;
    // Derive image URLs at call time (not at definition time)
    const imageUrls = post.image_urls?.length ? post.image_urls : post.image_url ? [post.image_url] : [];
    const imageUrl = imageUrls[0];

    if (navigator.share) {
      try {
        // Attempt to share with an image file if available and supported
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
          } catch {
            // Image fetch failed or files not supported — fall through to text-only share
          }
        }
        // Text-only share fallback
        await navigator.share({
          title: post.title || "Post on Yrdly",
          text: post.text ? post.text.slice(0, 100) : "",
          url,
        });
      } catch {
        // User cancelled share — do nothing
      }
    } else {
      // Desktop fallback: copy link to clipboard
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

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, [role="dialog"], [role="menu"]')) return;
    if (window.getSelection()?.toString()) return;
    if (!isCommentsOpen) router.push(`/posts/${post.id}`);
  };

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index);
    setIsImageSwiperOpen(true);
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
    <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
      <div className="flex items-center gap-3 min-w-0">
        {loadingAuthor ? (
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" style={{ background: "var(--c-card2)" }} />
        ) : (
          <button onClick={openProfile} className="flex-shrink-0">
            <Avatar className="h-10 w-10">
              <AvatarImage src={author?.avatar_url} />
              <AvatarFallback className="text-xs text-foreground" style={{ background: GREEN }}>{author?.name?.charAt(0) || "?"}</AvatarFallback>
            </Avatar>
          </button>
        )}
        {loadingAuthor ? (
          <div className="space-y-1">
            <Skeleton className="h-3 w-24" style={{ background: "var(--c-card2)" }} />
            <Skeleton className="h-2 w-16" style={{ background: "var(--c-card2)" }} />
          </div>
        ) : (
          <div className="min-w-0">
            <button onClick={openProfile}>
              <p className="font-sans font-bold text-[0.875rem] text-foreground truncate hover:underline">{author?.name || "Anonymous"}</p>
            </button>
            <p className="font-sans font-normal text-[0.6875rem] text-muted-foreground">{timeAgo(post.timestamp ? new Date(post.timestamp) : null)}</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <CategoryTag category={post.category} />
        {currentUser?.id === post.user_id && (
          <AlertDialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-2 -m-2 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border">
                {post.category === "Event" ? (
                  <CreateEventDialog postToEdit={post} open={isEventEditDialogOpen} onOpenChange={setIsEventEditDialogOpen}>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="focus:bg-accent">
                      <Edit className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                  </CreateEventDialog>
                ) : onCreatePost ? (
                  <CreatePostDialog postToEdit={post} createPost={onCreatePost}>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="focus:bg-accent">
                      <Edit className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                  </CreatePostDialog>
                ) : null}
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-red-400 focus:text-red-400 focus:bg-red-500/10">
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialogContent className="bg-card border-border">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete post?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently delete your post and all its comments.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-muted border-0">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
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
          <p className="px-4 pb-2 font-sans font-bold text-[1.125rem] text-foreground leading-[21px]">
            {post.title || post.text?.split("\n")[0]}
          </p>
        )}
        {/* image */}
        {urls.length > 0 && (
          <div className="px-3 pb-3">
            <ImageCollage urls={urls} onImageClick={handleImageClick} />
          </div>
        )}
        {/* Description text */}
        {post.text && post.title && (
          <p className="px-4 pb-2 font-sans font-normal text-[0.8125rem] text-muted-foreground leading-[15px]">{post.text}</p>
        )}
        {/* Event meta */}
        <div className="px-4 pb-3 space-y-2">
          {post.event_date && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-5 h-5 flex-shrink-0" />
              <span className="font-sans font-normal text-[0.8125rem]">{getEventDate()}</span>
            </div>
          )}
          {post.event_location && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="w-5 h-5 flex-shrink-0" />
              <span className="font-sans font-normal text-[0.8125rem]">{getLocation(post.event_location)}</span>
            </div>
          )}
        </div>
        {/* Price + share */}
        {post.price != null && post.price > 0 && (
          <div className="flex items-center justify-between px-4 pb-3">
            <span className="font-sans font-bold text-[1.5rem] leading-[28px]" style={{ color: GREEN }}>
              {formatPrice(post.price)}
            </span>
            <button onClick={handleShare} className="text-muted-foreground hover:text-foreground">
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        )}
        {/* I'm Interested */}
        <div className="flex items-center justify-end px-4 pb-4">
          <button
            onClick={handleLike}
            className="px-5 py-2 rounded-full text-foreground text-[0.8125rem] font-light transition-opacity hover:opacity-90"
            style={{ background: GREEN, fontFamily: FONT_RALEWAY }}
          >
            {isLiked ? "Interested ✓" : "I'm Interested"}
          </button>
        </div>
      </>
    );
  } else if (post.category === "For Sale") {
    const itemTitle = post.title || post.text?.split("\n")[0] || "Item";
    const desc = post.description || (post.title ? post.text : undefined);
    cardContent = (
      <>
        {PostHeader}
        {/* Item name */}
        <p className="px-4 pb-2 font-sans font-semibold text-[1.125rem] text-foreground leading-[21px]">{itemTitle}</p>
        {/* image */}
        {urls.length > 0 && (
          <div className="px-3 pb-3">
            <div className="relative w-full overflow-hidden" style={{ borderRadius: 12, height: 320, maxHeight: 320 }}>
              <Image src={urls[0]} alt="" fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover" />
            </div>
          </div>
        )}
        {/* Price */}
        <p className="px-4 pb-1 font-sans font-bold text-[1.5rem] leading-[28px]" style={{ color: GREEN }}>
          {post.price ? formatPrice(post.price) : "Free"}
        </p>
        {/* Description / subtitle */}
        {desc && (
          <p className="px-4 pb-3 font-sans font-normal text-[0.8125rem] text-muted-foreground leading-[15px]">{desc}</p>
        )}
        {/* Divider */}
        <div className="mx-4 mb-2" style={{ borderTop: "0.2px solid rgba(0,0,0,0.08)" }} />
        {/* Message seller */}
        <div className="flex items-center justify-between px-4 pb-3 gap-2">
          <div
            className="flex-1 flex items-center rounded-full overflow-hidden h-10 gap-2 px-4"
            style={{ background: BG, border: `0.5px solid ${GREEN}` }}
          >
            <Avatar className="h-6 w-6 flex-shrink-0">
              <AvatarImage src={author?.avatar_url} />
              <AvatarFallback className="text-[0.5625rem] text-foreground" style={{ background: GREEN }}>{author?.name?.charAt(0)}</AvatarFallback>
            </Avatar>
            <button
              onClick={handleMessageSeller}
              className="flex-1 text-left font-sans italic font-extralight text-[0.625rem] text-muted-foreground"
            >
              {currentUser?.id === author?.id ? "Your listing" : "Send seller a message"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleShare} className="text-muted-foreground hover:text-foreground">
              <Share2 className="w-5 h-5" />
            </button>
            <button
              onClick={handleLike}
              className="px-4 py-2 rounded-full text-foreground text-[0.8125rem] font-light transition-opacity hover:opacity-90"
              style={{ background: GREEN, fontFamily: FONT_RALEWAY }}
            >
              {isLiked ? "Saved ✓" : "I'm interested"}
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
          <div className="px-4 pb-3">
            <p className="font-sans font-normal text-[0.8125rem] leading-[15px] text-foreground whitespace-pre-wrap">
              {displayText}
              {shouldTruncate && (
                <button
                  onClick={(e) => { e.stopPropagation(); setIsTextExpanded(!isTextExpanded); }}
                  className="ml-1 font-sans font-medium text-[0.75rem] text-muted-foreground hover:text-primary"
                >
                  {isTextExpanded ? "see less" : "see more"}
                </button>
              )}
            </p>
          </div>
        )}
        {/* Images */}
        {urls.length > 0 && (
          <div className="px-3 pb-3">
            <ImageCollage urls={urls} onImageClick={handleImageClick} />
          </div>
        )}
        {/* Engagement */}
        <div className="px-4 pb-4 border-t border-border pt-3">
          <EngagementRow
            likes={likes}
            commentCount={commentCount}
            isLiked={isLiked}
            onLike={handleLike}
            onComment={() => setIsCommentsOpen(true)}
            onShare={handleShare}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className="w-full rounded-[11px] overflow-hidden cursor-pointer"
        style={{ background: CARD_BG }}
        onClick={handleCardClick}
      >
        {cardContent}
      </div>

      {/* Comments Sheet */}
      <Sheet open={isCommentsOpen} onOpenChange={setIsCommentsOpen}>
        <SheetContent side="bottom" className="p-0 flex flex-col rounded-t-2xl border-0" style={{ background: BG, maxHeight: "90vh" }}>
          <SheetHeader className="px-4 py-3 border-b border-border flex-shrink-0">
            <SheetTitle className="text-center text-foreground font-sans">Comments</SheetTitle>
          </SheetHeader>
          <CommentSection
            postId={post.id}
            post={post}
            author={author}
            onCommentCountChange={setCommentCount}
            onClose={() => setIsCommentsOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Image Swiper */}
      {urls.length > 0 && (
        <ImageSwiper
          images={urls}
          isOpen={isImageSwiperOpen}
          onClose={() => setIsImageSwiperOpen(false)}
          initialIndex={selectedImageIndex}
        />
      )}
    </>
  );
}
