"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Bell, BellSlash, Heart, ChatCircle, PaperPlaneTilt,
  UsersThree, SpinnerGap, Warning, Trash,
} from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { CommunityService, Community, CommunityPost, CommunityMembership } from "@/lib/community-service";
import { cn } from "@/lib/utils";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function PostCard({
  post,
  userId,
  onLike,
  onDelete,
  onClick,
}: {
  post: CommunityPost;
  userId: string;
  onLike: (p: CommunityPost) => void;
  onDelete?: (p: CommunityPost) => void;
  onClick: (p: CommunityPost) => void;
}) {
  return (
    <article className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start gap-3 mb-3">
        {post.author?.avatar_url ? (
          <img src={post.author.avatar_url} alt={post.author_name ?? ""} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary font-bold text-sm">
            {(post.author_name ?? "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm text-foreground">{post.author_name ?? "User"}</span>
          <span className="text-xs text-muted-foreground ml-2">{timeAgo(post.created_at)}{post.is_edited ? " · edited" : ""}</span>
          {post.is_pinned && (
            <span className="ml-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">📌 Pinned</span>
          )}
        </div>
        {onDelete && post.author_id === userId && (
          <button onClick={() => onDelete(post)} className="text-muted-foreground hover:text-destructive transition-colors p-1">
            <Trash size={15} />
          </button>
        )}
      </div>

      <button className="text-left w-full" onClick={() => onClick(post)}>
        <p className="text-sm text-foreground leading-relaxed">{post.content}</p>
        {post.image_urls?.length ? (
          <div className="flex gap-2 mt-3 flex-wrap">
            {post.image_urls.slice(0, 4).map((url, i) => (
              <img key={i} src={url} alt="" className="w-20 h-20 rounded-lg object-cover" />
            ))}
          </div>
        ) : null}
      </button>

      <div className="flex items-center gap-5 mt-4 pt-3 border-t border-border/50">
        <button
          onClick={() => onLike(post)}
          className={cn("flex items-center gap-1.5 text-sm transition-colors", post.liked_by_me ? "text-red-500" : "text-muted-foreground hover:text-foreground")}
        >
          <Heart size={16} weight={post.liked_by_me ? "fill" : "regular"} />
          {post.like_count > 0 && <span>{post.like_count}</span>}
        </button>
        <button onClick={() => onClick(post)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChatCircle size={16} />
          {post.comment_count > 0 && <span>{post.comment_count}</span>}
        </button>
      </div>
    </article>
  );
}

function LgaFallback({ communityId }: { communityId: string }) {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  useEffect(() => { CommunityService.fetchParentLgaPosts(communityId).then(setPosts).catch(() => {}); }, [communityId]);
  if (!posts.length) return null;
  return (
    <div className="mt-6 border-t border-border pt-6">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">More from the area</h3>
      <div className="flex flex-col gap-3">
        {posts.map((p) => (
          <div key={p.id} className="bg-card/60 border border-border rounded-xl p-3">
            <p className="text-sm text-foreground">{p.content}</p>
            <span className="text-xs text-muted-foreground mt-2 block">{p.author_name} · {timeAgo(p.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommunityFeedPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();

  const [community, setCommunity] = useState<Community | null>(null);
  const [membership, setMembership] = useState<CommunityMembership | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSparse, setIsSparse] = useState(false);
  const [postText, setPostText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id || !user) return;
    const [comm, mem, postsData] = await Promise.all([
      CommunityService.getCommunity(id),
      CommunityService.getMyMembership(id),
      CommunityService.fetchPosts(id),
    ]);
    setCommunity(comm);
    setMembership(mem);
    if (postsData.length) {
      const { data: likedRows } = await supabase
        .from("community_post_likes")
        .select("post_id")
        .eq("user_id", user.id)
        .in("post_id", postsData.map((p) => p.id));
      const likedSet = new Set((likedRows ?? []).map((r: any) => r.post_id));
      setPosts(postsData.map((p) => ({ ...p, liked_by_me: likedSet.has(p.id) })));
    } else {
      setPosts([]);
    }
    if (comm?.type === "ward") {
      const sparse = await CommunityService.isWardSparse(id);
      setIsSparse(sparse);
    }
    setLoading(false);
  }, [id, user]);

  useEffect(() => { load(); }, [load]);

  // Realtime
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`web-community-feed-${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_posts", filter: `community_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, load]);

  const handleJoin = async () => {
    if (!user || !community) return;
    if (community.privacy === "open") await CommunityService.joinCommunity(community.id, user.id);
    else if (community.privacy === "request") await CommunityService.requestToJoin(community.id, user.id);
    load();
  };

  const handlePost = async () => {
    if (!postText.trim() || !user || !community || !membership) return;
    setPosting(true);
    setError(null);
    try {
      await CommunityService.createPost({
        communityId: community.id,
        authorId: user.id,
        authorName: (profile as any)?.name ?? "User",
        authorImage: (profile as any)?.avatar_url ?? null,
        content: postText.trim(),
        phoneVerified: (profile as any)?.phone_verified ?? false,
        memberRole: membership.role,
      });
      setPostText("");
      load();
    } catch (e: any) {
      setError(e.message ?? "Could not post");
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (post: CommunityPost) => {
    if (!user) return;
    const action = post.liked_by_me ? "unlike" : "like";
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, liked_by_me: !p.liked_by_me, like_count: p.like_count + (post.liked_by_me ? -1 : 1) } : p));
    await supabase.rpc("community_toggle_post_like", { p_post_id: post.id, p_user_id: user.id, p_action: action });
  };

  const handleDelete = async (post: CommunityPost) => {
    if (!window.confirm("Delete this post?")) return;
    await CommunityService.deletePost(post.id);
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
  };

  const toggleMute = async () => {
    if (!user || !community || !membership) return;
    await CommunityService.setMuted(community.id, user.id, !membership.is_muted);
    setMembership({ ...membership, is_muted: !membership.is_muted });
  };

  if (loading) return (
    <div className="flex justify-center pt-24"><SpinnerGap size={36} className="animate-spin text-primary" /></div>
  );

  if (!community) return (
    <div className="flex flex-col items-center pt-24 gap-3">
      <Warning size={48} className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Community not found.</p>
    </div>
  );

  const isMember = membership?.status === "active";

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-lg text-foreground truncate">{community.name}</h1>
          <p className="text-xs text-muted-foreground">{community.member_count} members</p>
        </div>
        {isMember && (
          <button onClick={toggleMute} className="p-2 rounded-lg hover:bg-accent transition-colors" title={membership?.is_muted ? "Unmute notifications" : "Mute notifications"}>
            {membership?.is_muted ? <BellSlash size={18} className="text-muted-foreground" /> : <Bell size={18} className="text-muted-foreground" />}
          </button>
        )}
      </div>

      {/* Join CTA */}
      {!isMember && community.privacy !== "invite" && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-sm text-foreground">{community.description ?? `Join ${community.name} to see posts`}</p>
          </div>
          <button
            onClick={handleJoin}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg flex-shrink-0 hover:opacity-90 transition-opacity"
          >
            {community.privacy === "open" ? "Join" : "Request"}
          </button>
        </div>
      )}

      {/* Compose */}
      {isMember && (
        <div className="bg-card border border-border rounded-xl p-3 mb-5">
          <textarea
            className="w-full resize-none text-sm text-foreground bg-transparent placeholder:text-muted-foreground focus:outline-none min-h-[72px]"
            placeholder={`Post to ${community.name}…`}
            value={postText}
            onChange={(e) => setPostText(e.target.value)}
            maxLength={1000}
          />
          {error && <p className="text-xs text-destructive mb-2">{error}</p>}
          <div className="flex justify-end">
            <button
              onClick={handlePost}
              disabled={!postText.trim() || posting}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {posting ? <SpinnerGap size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} weight="fill" />}
              Post
            </button>
          </div>
        </div>
      )}

      {/* Feed */}
      {isMember ? (
        posts.length === 0 ? (
          <div className="flex flex-col items-center pt-10 gap-3 text-center">
            <UsersThree size={48} className="text-primary" weight="light" />
            <p className="font-bold text-lg text-foreground">Be the first to post here</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {community.name} is just getting started. Share something with your neighbours.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                userId={user?.id ?? ""}
                onLike={handleLike}
                onDelete={handleDelete}
                onClick={(post) => router.push(`/communities/${id}/posts/${post.id}`)}
              />
            ))}
            {isSparse && community.type === "ward" && <LgaFallback communityId={community.id} />}
          </div>
        )
      ) : (
        <div className="text-center pt-10">
          <UsersThree size={48} className="text-muted-foreground mx-auto mb-3" weight="light" />
          <p className="text-sm text-muted-foreground">
            {community.privacy === "invite" ? "This is an invite-only community." : "Join to see community posts."}
          </p>
        </div>
      )}
    </div>
  );
}
