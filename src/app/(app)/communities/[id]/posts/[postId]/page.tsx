"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, PaperPlaneTilt, SpinnerGap } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { CommunityService, CommunityPost, CommunityComment } from "@/lib/community-service";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function CommunityPostPage() {
  const { id, postId } = useParams<{ id: string; postId: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();

  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    if (!postId) return;
    const data = await CommunityService.fetchComments(postId).catch(() => []);
    setComments(data);
  }, [postId]);

  useEffect(() => {
    if (!postId) return;
    supabase
      .from("community_posts")
      .select("*, author:users!community_posts_author_id_fkey(id, name, avatar_url)")
      .eq("id", postId)
      .single()
      .then(({ data }) => { setPost(data as CommunityPost ?? null); });
    loadComments().then(() => setLoading(false));
  }, [postId, loadComments]);

  // Realtime comments
  useEffect(() => {
    if (!postId) return;
    const channel = supabase
      .channel(`web-community-comments-${postId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_comments", filter: `post_id=eq.${postId}` }, () => loadComments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [postId, loadComments]);

  const handleSend = async () => {
    if (!text.trim() || !user || !post || !id) return;
    setSending(true);
    setError(null);
    try {
      await CommunityService.createComment({
        postId: post.id,
        communityId: id,
        authorId: user.id,
        authorName: (profile as any)?.name ?? "User",
        authorImage: (profile as any)?.avatar_url ?? null,
        content: text.trim(),
        phoneVerified: (profile as any)?.phone_verified ?? false,
      });
      setText("");
    } catch (e: any) {
      setError(e.message ?? "Could not send reply");
    } finally {
      setSending(false);
    }
  };

  if (loading || !post) return (
    <div className="flex justify-center pt-24"><SpinnerGap size={36} className="animate-spin text-primary" /></div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h1 className="font-bold text-lg text-foreground">Replies</h1>
      </div>

      {/* Original post */}
      <div className="bg-card border border-border rounded-xl p-4 mb-5">
        <div className="flex items-center gap-2 mb-2">
          {post.author?.avatar_url ? (
            <img src={post.author.avatar_url} alt={post.author_name ?? ""} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
              {(post.author_name ?? "?")[0].toUpperCase()}
            </div>
          )}
          <span className="font-semibold text-sm text-foreground">{post.author_name}</span>
          <span className="text-xs text-muted-foreground">{timeAgo(post.created_at)}</span>
        </div>
        <p className="text-sm text-foreground leading-relaxed">{post.content}</p>
        <p className="text-xs text-muted-foreground mt-3">{post.like_count} likes · {post.comment_count} replies</p>
      </div>

      {/* Reply compose */}
      <div className="bg-card border border-border rounded-xl p-3 mb-5">
        <textarea
          className="w-full resize-none text-sm text-foreground bg-transparent placeholder:text-muted-foreground focus:outline-none min-h-[56px]"
          placeholder="Write a reply…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
        />
        {error && <p className="text-xs text-destructive mb-2">{error}</p>}
        <div className="flex justify-end">
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {sending ? <SpinnerGap size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} weight="fill" />}
            Reply
          </button>
        </div>
      </div>

      {/* Comments */}
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center pt-6">No replies yet. Be the first!</p>
      ) : (
        <div className="flex flex-col gap-3">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-3">
              {c.author_image ? (
                <img src={c.author_image} alt={c.author_name ?? ""} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                  {(c.author_name ?? "?")[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 bg-card border border-border rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-xs text-foreground">{c.author_name}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                </div>
                <p className="text-sm text-foreground">{c.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
