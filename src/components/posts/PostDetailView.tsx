"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { MediaCollage, type MediaItem } from "./PostCard";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircleMore,
  Share2,
  Bookmark,
  MoreHorizontal,
  Trash2,
  Edit,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/supabase";
import { CommentSection } from "@/components/CommentSection";
import { timeAgo } from "@/lib/shared/utils";
import type { Post, User } from "@/types/index";
import { cn } from "@/lib/shared/utils";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

interface PostDetailViewProps {
  post: Post;
  onCommentCountChange?: (count: number) => void;
}

export function PostDetailView({
  post,
  onCommentCountChange,
}: PostDetailViewProps) {
  const router = useRouter();
  const { user: currentUser, profile: userDetails } = useAuth();
  const { toast } = useToast();
  const [author, setAuthor] = useState<User | null>(null);
  const [loadingAuthor, setLoadingAuthor] = useState(true);
  const [likes, setLikes] = useState(post.liked_by?.length || 0);
  const [commentCount, setCommentCount] = useState(post.comment_count || 0);
  const [isLiked, setIsLiked] = useState(false);
  const [isLikePending, setIsLikePending] = useState(false);
  const likePendingRef = useRef(false);
  const [isEventEditDialogOpen, setIsEventEditDialogOpen] = useState(false);
  const [isPostEditDialogOpen, setIsPostEditDialogOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const savePending = useRef(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
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
          avatar_url:
            post.user.avatar_url ||
            post.author_image ||
            "https://placehold.co/100x100.png",
          timestamp: post.timestamp,
        });
        setLoadingAuthor(false);
        return;
      }
      const { data } = await supabase
        .from("public_profiles")
        .select("id, name, avatar_url, created_at")
        .eq("id", post.user_id)
        .single();
      if (data) {
        setAuthor({
          id: data.id,
          uid: data.id,
          name: data.name || post.author_name || "Anonymous",
          avatar_url:
            data.avatar_url ||
            post.author_image ||
            "https://placehold.co/100x100.png",
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
  }, [
    post.user_id,
    post.user,
    post.author_name,
    post.author_image,
    post.timestamp,
  ]);

  useEffect(() => {
    setLikes(post.liked_by?.length || 0);
    setCommentCount(post.comment_count || 0);
    if (currentUser && post.liked_by)
      setIsLiked(post.liked_by.includes(currentUser.id));
    const ch = supabase
      .channel(`post-detail-${post.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "posts",
          filter: `id=eq.${post.id}`,
        },
        (payload: any) => {
          if (payload.new) {
            const p = payload.new;
            setLikes(p.liked_by?.length || 0);
            setCommentCount(p.comment_count || 0);
            if (currentUser && p.liked_by)
              setIsLiked(p.liked_by.includes(currentUser.id));
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [post.id, post.liked_by, post.comment_count, currentUser]);

  const handleBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/home");
  };

  const handleLike = useCallback(async () => {
    if (!currentUser || !post.id || likePendingRef.current) return;
    likePendingRef.current = true;
    setIsLikePending(true);

    const previousIsLiked = isLiked;
    const nextIsLiked = !previousIsLiked;
    setIsLiked(nextIsLiked);
    setLikes((previousLikes) =>
      Math.max(0, previousLikes + (nextIsLiked ? 1 : -1)),
    );

    try {
      const { data, error } = await supabase.rpc("toggle_post_like", {
        p_post_id: post.id,
        p_user_id: currentUser.id,
      });
      if (error || !data)
        throw error || new Error("Like update returned no data.");
      setIsLiked(data.is_liked);
      setLikes(data.likes_count);
      window.dispatchEvent(
        new CustomEvent("yrdly:post-update", {
          detail: { postId: post.id, updates: { liked_by: data.liked_by } },
        }),
      );
    } catch (error) {
      console.error("Error updating post like:", error);
      setIsLiked(previousIsLiked);
      setLikes((previousLikes) =>
        Math.max(0, previousLikes + (previousIsLiked ? 1 : -1)),
      );
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not update your like.",
      });
    } finally {
      likePendingRef.current = false;
      setIsLikePending(false);
    }
  }, [currentUser, isLiked, post.id, toast]);

  useEffect(() => {
    if (!currentUser) {
      setSaved(false);
      return;
    }
    let active = true;
    void supabase
      .from("post_bookmarks")
      .select("id")
      .eq("post_id", post.id)
      .eq("user_id", currentUser.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setSaved(!!data);
      });
    return () => {
      active = false;
    };
  }, [post.id, currentUser?.id]);
  const toggleSaved = async () => {
    if (!currentUser || savePending.current) return;
    savePending.current = true;
    const before = saved;
    setSaved(!before);
    try {
      const result = before
        ? await supabase
            .from("post_bookmarks")
            .delete()
            .eq("post_id", post.id)
            .eq("user_id", currentUser.id)
        : await supabase
            .from("post_bookmarks")
            .insert({ post_id: post.id, user_id: currentUser.id });
      if (result.error) throw result.error;
      window.dispatchEvent(
        new CustomEvent("yrdly:bookmark", {
          detail: { postId: post.id, saved: !before },
        }),
      );
    } catch {
      setSaved(before);
    } finally {
      savePending.current = false;
    }
  };

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/posts/${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Post on Yrdly", url });
        if (currentUser?.id) {
          const { NotificationTriggers } =
            await import("@/lib/notifications/notification-triggers");
          await NotificationTriggers.onPostShared(post.id, currentUser.id);
        }
        toast({ title: "Post shared!" });
      } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      if (currentUser?.id) {
        const { NotificationTriggers } =
          await import("@/lib/notifications/notification-triggers");
        await NotificationTriggers.onPostShared(post.id, currentUser.id);
      }
      toast({ title: "Link copied!" });
    }
  }, [currentUser?.id, post.id, toast]);

  const handleDelete = useCallback(async () => {
    if (!currentUser || currentUser.id !== post.user_id) return;
    const { error } = await supabase.from("posts").delete().eq("id", post.id);
    if (error) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error.message,
      });
      return;
    }
    await supabase.from("comments").delete().eq("post_id", post.id);
    toast({ title: "Post deleted" });
    router.push("/home");
  }, [currentUser, post.id, post.user_id, router, toast]);

  const handleCommentCountChange = useCallback(
    (count: number) => {
      setCommentCount(count);
      onCommentCountChange?.(count);
    },
    [onCommentCountChange],
  );

  const urls = post.image_urls?.length
    ? post.image_urls
    : post.image_url
      ? [post.image_url]
      : [];
  const videoUrls = Array.from(
    new Set([
      ...(post.video_urls || []),
      ...(post.video_url ? [post.video_url] : []),
    ]),
  );
  const mediaItems: MediaItem[] = [
    ...urls.map((url) => ({ type: "image" as const, url })),
    ...videoUrls.map((url) => ({ type: "video" as const, url })),
  ];

  return (
    <div
      className={cn(
        "w-full rounded-[16px] overflow-hidden border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl text-[var(--yrdly-text-primary)] font-yrdly-body shadow-xl",
      )}
    >
      {/* Top bar: back + "Post" */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--yrdly-glass-border)] bg-white/[0.03]">
        <button
          onClick={handleBack}
          className="p-1 -ml-1 rounded hover:bg-accent text-[var(--yrdly-text-primary)]"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-yrdly-display font-semibold text-sm leading-tight text-[var(--yrdly-text-primary)]">
          Post
        </span>
      </div>

      {/* Main content grid: 1-col on mobile, 2-col on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 lg:divide-x lg:divide-[var(--yrdly-glass-border)]">
        {/* Left column — post header, text, media, engagement */}
        <div className="lg:col-span-7 xl:col-span-7 flex flex-col min-w-0">
          {/* Post header: avatar, name, time, tag */}
          <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
            <div className="flex items-center gap-3 min-w-0">
              {loadingAuthor ? (
                <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
              ) : (
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarImage src={author?.avatar_url} />
                  <AvatarFallback className="bg-[#82DB7E] text-[#050505] font-yrdly-display text-sm font-bold">
                    {author?.name?.charAt(0) || "?"}
                  </AvatarFallback>
                </Avatar>
              )}
              <div className="min-w-0">
                <p className="font-yrdly-display font-bold text-sm text-[var(--yrdly-text-primary)] truncate">
                  {author?.name || "Anonymous"}
                </p>
                <p className="font-yrdly-body font-normal text-[0.6875rem] text-[var(--yrdly-label)]">
                  {timeAgo(post.timestamp ? new Date(post.timestamp) : null)}
                  {post.updated_at &&
                    new Date(post.updated_at).getTime() -
                      new Date(post.timestamp).getTime() >
                      2000 &&
                    " (edited)"}
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

          {mediaItems.length > 0 && (
            <div className="pb-4">
              <MediaCollage
                items={mediaItems}
                expanded
                poster={post.video_thumbnail_url ?? undefined}
                onImageClick={(index) => {
                  if (mediaItems[index]?.type === "image")
                    setLightboxIndex(index);
                }}
              />
            </div>
          )}

          {/* Engagement row */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleLike}
                  disabled={isLikePending || !currentUser}
                  aria-pressed={isLiked}
                  className="flex items-center justify-center w-11 h-11 p-2.5 rounded-lg bg-[#D9D9D9]/20 hover:bg-accent disabled:cursor-not-allowed"
                >
                  <Heart
                    className={cn(
                      "w-5 h-5",
                      isLiked && "fill-[#82DB7E] text-[#82DB7E]",
                    )}
                  />
                </button>
                <span className="font-sans font-light italic text-xs text-foreground">
                  {formatCount(likes)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <MessageCircleMore className="w-5 h-5 text-foreground" />
                <span className="font-sans font-light text-xs text-foreground">
                  {formatCount(commentCount)}
                </span>
              </div>
              <button
                onClick={() => void toggleSaved()}
                disabled={!currentUser}
                aria-label={saved ? "Remove bookmark" : "Save post"}
                aria-pressed={saved}
                className="p-2 rounded hover:bg-accent"
              >
                <Bookmark
                  className={cn(
                    "w-5 h-5",
                    saved && "fill-primary text-primary",
                  )}
                />
              </button>
              <button
                onClick={handleShare}
                className="p-1 rounded hover:bg-accent"
              >
                <Share2 className="w-6 h-6" />
              </button>
            </div>
            {currentUser?.id === post.user_id && (
              <AlertDialog>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1 rounded hover:bg-accent">
                      <MoreHorizontal className="w-6 h-6" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="bg-card border-border"
                  >
                    {(() => {
                      const canEdit =
                        Date.now() -
                          new Date(
                            post.created_at || post.timestamp || Date.now(),
                          ).getTime() <=
                        15 * 60 * 1000;
                      if (!canEdit) return null;

                      if (post.category === "Event") {
                        return (
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(`/events/${post.id}/manage`)
                            }
                            className="text-foreground focus:bg-accent cursor-pointer"
                          >
                            <Edit className="mr-2 h-4 w-4" /> Manage Event
                          </DropdownMenuItem>
                        );
                      }

                      if (
                        (post as any).category === "For Sale" ||
                        (post as any).category === "Giveaway"
                      ) {
                        return (
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(`/marketplace/edit/${post.id}`)
                            }
                            className="text-foreground focus:bg-accent cursor-pointer"
                          >
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
                    <AlertDialogCancel className="bg-background/10 text-foreground border-0">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Right column — comment input + CommentSection (desktop side column) */}
        <div className="lg:col-span-5 xl:col-span-5 flex flex-col border-t lg:border-t-0 border-border">
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

      {/* Full Screen Image Lightbox Modal */}
      {lightboxIndex !== null && urls[lightboxIndex] && (
        <div
          className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-md flex flex-col justify-between items-center select-none"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Top Bar */}
          <div
            className="w-full flex items-center justify-between px-4 py-3.5 z-10 bg-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-white font-medium text-sm font-yrdly-body">
              {lightboxIndex + 1} / {urls.length}
            </span>
            <button
              onClick={() => setLightboxIndex(null)}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Close full screen view"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Center Image Container */}
          <div
            className="relative flex-1 w-full flex items-center justify-center p-2 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative w-full h-full max-w-5xl max-h-[85vh]">
              <Image
                src={urls[lightboxIndex]}
                alt={`Full screen image ${lightboxIndex + 1}`}
                fill
                className="object-contain"
                sizes="100vw"
                priority
              />
            </div>

            {/* Previous Image Button */}
            {urls.length > 1 && lightboxIndex > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(lightboxIndex - 1);
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center z-20"
                aria-label="Previous image"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            {/* Next Image Button */}
            {urls.length > 1 && lightboxIndex < urls.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(lightboxIndex + 1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center z-20"
                aria-label="Next image"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* Bottom Dot Indicators */}
          {urls.length > 1 && (
            <div
              className="flex items-center gap-2 pb-6 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {urls.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setLightboxIndex(i)}
                  className={cn(
                    "w-2.5 h-2.5 rounded-full transition-all",
                    i === lightboxIndex
                      ? "bg-[#82DB7E] scale-125"
                      : "bg-white/40 hover:bg-white/70",
                  )}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
