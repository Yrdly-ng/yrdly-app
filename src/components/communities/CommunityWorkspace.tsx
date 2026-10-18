"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommunityService,
  Community,
  CommunityPost,
  CommunityComment,
  CommunityMembership,
  CommunityJoinRequest,
} from "@/lib/communities/community-service";
import { supabase } from "@/lib/supabase/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { CommunityComposer } from "./CommunityComposer";
import { CommunityManager } from "./CommunityManagement";
import { CommunityMedia } from "./CommunityMedia";
import { communityButton } from "./CommunityTools";

export function CommunityWorkspace({
  id,
  postId,
}: {
  id: string;
  postId?: string;
}) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [community, setCommunity] = useState<Community | null>(null);
  const [membership, setMembership] = useState<CommunityMembership | null>(
    null,
  );
  const [request, setRequest] = useState<CommunityJoinRequest | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [invite, setInvite] = useState<any>(null);
  const [offer, setOffer] = useState<any>(null);
  const [area, setArea] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [managing, setManaging] = useState(false);
  const [composer, setComposer] = useState<{
    post?: CommunityPost;
    comment?: CommunityComment;
    replyTo?: string;
  } | null>(null);
  const page = useRef(0);
  const revision = useRef(0);
  const inFlight = useRef(false);
  const likes = useRef(new Set<string>());
  const active = membership?.status === "active";
  const role = CommunityService.isStaffProfile(profile)
    ? "staff"
    : community?.owner_id === user?.id
      ? "owner"
      : active
        ? membership!.role
        : "";
  const leader = ["staff", "owner", "admin", "moderator"].includes(role);
  const load = useCallback(async () => {
    if (!user?.id) return;
    const started = ++revision.current;
    setError("");
    try {
      const [comm, mem, join, ownership, invitation] = await Promise.all([
        CommunityService.getCommunity(id),
        CommunityService.getMyMembership(id, user.id),
        CommunityService.getMyJoinRequest(id, user.id),
        CommunityService.ownershipOffer(id),
        CommunityService.getMyInvite(id, user.id),
      ]);
      if (started !== revision.current) return;
      setCommunity(comm);
      setMembership(mem);
      setRequest(join);
      setOffer(ownership);
      setInvite(invitation);
      if (postId) {
        const [item, replies] = await Promise.all([
          CommunityService.getPost(id, postId),
          CommunityService.fetchComments(postId),
        ]);
        const enriched = item;
        if (started === revision.current) {
          setPost(enriched);
          setComments(replies);
        }
      } else {
        const feed = await CommunityService.fetchPosts(id);
        const liked = feed.length
          ? await supabase
              .from("community_post_likes")
              .select("post_id")
              .eq("user_id", user.id)
              .in(
                "post_id",
                feed.map((item) => item.id),
              )
          : { data: [], error: null };
        if (liked.error) throw liked.error;
        const likedIds = new Set((liked.data || []).map((row) => row.post_id));
        if (started === revision.current) {
          setPosts(
            feed.map((item) => ({
              ...item,
              liked_by_me: likedIds.has(item.id),
            })),
          );
          setHasMore(feed.length === 20);
          page.current = 0;
        }
        if (
          comm?.type === "ward" &&
          mem?.status === "active" &&
          (await CommunityService.isWardSparse(id))
        ) {
          const more = await CommunityService.fetchParentLgaPosts(id);
          if (started === revision.current) setArea(more);
        } else setArea([]);
      }
    } catch (e: any) {
      if (started === revision.current)
        setError(e.message || "Could not load this community.");
    } finally {
      if (started === revision.current) setLoading(false);
    }
  }, [id, postId, user?.id]);
  useEffect(() => {
    setLoading(true);
    setCommunity(null);
    setMembership(null);
    setPosts([]);
    setPost(null);
    setComments([]);
    void load();
    const channel = supabase.channel(
      `community-workspace-${id}-${postId || "feed"}`,
    );
    for (const table of [
      "communities",
      "community_memberships",
      "community_join_requests",
      "community_invites",
      "community_ownership_transfers",
      "community_posts",
      "community_comments",
      "community_content_reviews",
    ])
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter:
            table === "communities" ? `id=eq.${id}` : `community_id=eq.${id}`,
        },
        () => void load(),
      );
    channel.on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "community_posts" },
      () => void load(),
    );
    channel
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "community_comments" },
        () => void load(),
      )
      .subscribe();
    const focus = () => void load();
    window.addEventListener("focus", focus);
    const mediaRefresh = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 240000);
    return () => {
      clearInterval(mediaRefresh);
      revision.current++;
      window.removeEventListener("focus", focus);
      void supabase.removeChannel(channel);
    };
  }, [id, postId, load]);
  const run = async (action: string, data: Record<string, unknown> = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await CommunityService.command(id, action, data);
      await load();
    } catch (e: any) {
      setError(e.message || "Could not complete action.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const like = async (item: CommunityPost) => {
    if (!user || likes.current.has(item.id)) return;
    likes.current.add(item.id);
    setPosts((current) =>
      current.map((value) =>
        value.id === item.id
          ? {
              ...value,
              liked_by_me: !item.liked_by_me,
              like_count: Math.max(
                0,
                item.like_count + (item.liked_by_me ? -1 : 1),
              ),
            }
          : value,
      ),
    );
    try {
      await CommunityService.togglePostLike(
        item.id,
        user.id,
        !!item.liked_by_me,
      );
    } catch (e: any) {
      setPosts((current) =>
        current.map((value) =>
          value.id === item.id
            ? {
                ...value,
                liked_by_me: item.liked_by_me,
                like_count: item.like_count,
              }
            : value,
        ),
      );
      setError(e.message || "Could not save like.");
    } finally {
      likes.current.delete(item.id);
    }
  };
  const more = async () => {
    if (loadingMore || !hasMore || !user) return;
    setLoadingMore(true);
    const started = revision.current;
    try {
      const next = await CommunityService.fetchPosts(id, page.current + 1);
      const liked = next.length
        ? await supabase
            .from("community_post_likes")
            .select("post_id")
            .eq("user_id", user.id)
            .in(
              "post_id",
              next.map((item) => item.id),
            )
        : { data: [], error: null };
      if (liked.error) throw liked.error;
      if (started !== revision.current) return;
      const ids = new Set((liked.data || []).map((row) => row.post_id));
      setPosts((current) =>
        Array.from(
          new Map(
            [
              ...current,
              ...next.map((item) => ({
                ...item,
                liked_by_me: ids.has(item.id),
              })),
            ].map((item) => [item.id, item]),
          ).values(),
        ),
      );
      setHasMore(next.length === 20);
      page.current++;
    } catch (e: any) {
      setError(e.message || "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  };
  const button = (label: string, callback: () => void, disabled = false) => (
    <button
      type="button"
      className={communityButton}
      disabled={disabled || busy}
      onClick={callback}
    >
      {label}
    </button>
  );
  const report = (kind: "post" | "comment", targetId: string) => {
    const reason = window.prompt(
      "Why are you reporting this content? (3–500 characters)",
    );
    if (reason?.trim()) void run("report", { kind, targetId, reason });
  };
  const cooldown =
    request?.status === "rejected" &&
    !!request.reviewed_at &&
    Date.now() - new Date(request.reviewed_at).getTime() < 7 * 86400000;
  const author = (item: CommunityPost | CommunityComment) => (
    <div className="flex items-center gap-2">
      <a
        href={`/profile/${item.author_id}`}
        className="flex items-center gap-2"
      >
        {(item.author?.avatar_url || item.author_image) && (
          <img
            src={item.author?.avatar_url || item.author_image || ""}
            alt=""
            className="h-9 w-9 rounded-full object-cover"
          />
        )}
        <span className="font-semibold">
          {item.author?.name || item.author_name || "Member"}
        </span>
      </a>
      {item.author?.phone_verified && <VerifiedBadge size={16} />}
      <time
        className="ml-auto text-xs text-muted-foreground"
        dateTime={item.created_at}
      >
        {new Date(item.created_at).toLocaleDateString()}
      </time>
    </div>
  );
  const state = (item: CommunityPost | CommunityComment) => (
    <>
      {item.moderation_status !== "approved" && (
        <p className="text-sm text-amber-600">
          Only you can see this ·{" "}
          {item.moderation_status === "rejected"
            ? "rejected"
            : "awaiting review"}
        </p>
      )}
      {item.revision_status && (
        <p className="text-sm text-amber-600">
          {item.revision_status === "pending"
            ? "Your edit is awaiting review. The published version remains visible."
            : `Your edit was rejected. ${item.revision_reason || "The published version is unchanged."}`}
        </p>
      )}
    </>
  );

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 pb-28">
      <header className="flex flex-wrap items-center gap-3">
        <a
          href={postId ? `/communities/${id}` : "/communities"}
          className={communityButton}
        >
          ← Back
        </a>
        {community?.avatar_url && (
          <img
            src={community.avatar_url}
            alt=""
            className="h-11 w-11 rounded-full object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">
            {community?.name || "Community"}
          </h1>
          {community && (
            <p className="text-sm text-muted-foreground">
              {community.member_count} members
            </p>
          )}
        </div>
        {button("Refresh", () => void load())}
      </header>
      {!!error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 p-4 text-sm text-red-500"
        >
          {error} {button("Try again", () => void load())}
        </div>
      )}
      {!!notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Loading community…</p>
      ) : (
        <>
          {!community && !error && (
            <p>
              This community is unavailable, or your invitation has expired.
            </p>
          )}
          {community && !postId && (
            <>
              {community.banner_url && (
                <img
                  src={community.banner_url}
                  alt="Community banner"
                  className="h-44 w-full rounded-2xl object-cover"
                />
              )}
              <p className="text-sm text-muted-foreground">
                {community.description}
              </p>
              {!!community.rules?.length && (
                <details className="rounded-xl border border-border p-4">
                  <summary className="cursor-pointer font-semibold">
                    Community rules
                  </summary>
                  <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
                    {community.rules.map((rule, index) => (
                      <li key={index}>{rule}</li>
                    ))}
                  </ol>
                </details>
              )}
            </>
          )}
          {offer && (
            <section className="space-y-3 rounded-xl border border-primary/30 p-4">
              <p>
                {offer.recipient_id === user?.id
                  ? "You have been offered community ownership. Accepting makes you responsible for this community."
                  : "Ownership offer awaiting acceptance."}
              </p>
              <div className="flex gap-2">
                {offer.recipient_id === user?.id ? (
                  <>
                    {button(
                      "Accept ownership",
                      () => void run("accept_ownership"),
                    )}
                    {button("Decline", () => void run("decline_ownership"))}
                  </>
                ) : (
                  button("Cancel offer", () => void run("cancel_ownership"))
                )}
              </div>
            </section>
          )}
          {community && !active && (
            <section className="space-y-3 rounded-xl border border-border p-4">
              <h2 className="font-semibold">
                {membership?.status === "banned"
                  ? "You are banned from this community"
                  : "Join to see community posts"}
              </h2>
              {membership?.status === "banned" ? (
                <p className="text-sm text-muted-foreground">
                  A community leader must lift the ban before you can join.
                </p>
              ) : invite ? (
                <div className="flex gap-2">
                  {button("Accept invitation", () => void run("accept_invite"))}
                  {button(
                    "Decline invitation",
                    () => void run("decline_invite"),
                  )}
                </div>
              ) : community.privacy === "open" ? (
                button("Join community", () => void run("join"))
              ) : community.privacy === "request" ? (
                request?.status === "pending" ? (
                  <>
                    <p className="text-sm">
                      Your join request is awaiting review.
                    </p>
                    {button("Withdraw request", () => void run("withdraw"))}
                  </>
                ) : (
                  <>
                    {cooldown && (
                      <p className="text-sm">
                        You can reapply seven days after rejection.
                      </p>
                    )}
                    {button(
                      "Request to join",
                      () => void run("request"),
                      !!cooldown,
                    )}
                  </>
                )
              ) : (
                <p className="text-sm">An invitation is required.</p>
              )}
            </section>
          )}
          {community && (active || role === "staff") && (
            <nav
              aria-label="Community actions"
              className="flex flex-wrap gap-2"
            >
              {button(leader ? "Manage community" : "Members", () =>
                setManaging(true),
              )}
              {active &&
                button(
                  membership?.is_muted ? "Unmute" : "Mute",
                  () => void run("mute", { muted: !membership?.is_muted }),
                )}
              {active &&
                button("Leave", () => {
                  if (role === "owner") {
                    setNotice(
                      "Offer ownership to another active member in Manage community, then wait for acceptance before leaving.",
                    );
                    setManaging(true);
                  } else if (
                    confirm(
                      "Leave this community? Your existing contributions remain.",
                    )
                  )
                    void run("leave");
                })}
              {community.privacy !== "invite" &&
                button("Copy community link", () => {
                  void navigator.clipboard
                    .writeText(`${window.location.origin}/communities/${id}`)
                    .then(() => setNotice("Community link copied."))
                    .catch(() => setError("Could not copy link."));
                })}
            </nav>
          )}
          {active && !postId && button("Write a post", () => setComposer({}))}
          {postId ? (
            !post ? (
              <section className="space-y-3">
                <p>
                  {active
                    ? "This post is no longer available."
                    : "Membership is required to view this post."}
                </p>
                <a className={communityButton} href={`/communities/${id}`}>
                  Go to community
                </a>
              </section>
            ) : (
              <>
                <article className="space-y-4 rounded-2xl border border-border bg-card p-5">
                  {author(post)}
                  {state(post)}
                  <p className="whitespace-pre-wrap">{post.content}</p>
                  <CommunityMedia post={post} />
                  <p className="text-sm text-muted-foreground">
                    {post.comment_count} published replies
                  </p>
                </article>
                {active &&
                  post.moderation_status === "approved" &&
                  button("Write a reply", () =>
                    setComposer({ replyTo: post.id }),
                  )}
                {comments.map((comment) => (
                  <article
                    key={comment.id}
                    className="space-y-3 rounded-xl border border-border bg-card p-4"
                  >
                    {author(comment)}
                    {state(comment)}
                    <p className="whitespace-pre-wrap">{comment.content}</p>
                    <div className="flex flex-wrap gap-2">
                      {comment.author_id === user?.id &&
                        button("Edit", () =>
                          setComposer({ comment, replyTo: postId }),
                        )}
                      {(leader || comment.author_id === user?.id) &&
                        button("Delete", () => {
                          if (confirm("Delete this reply?"))
                            void run("delete_comment", {
                              commentId: comment.id,
                            });
                        })}
                      {button("Report", () => report("comment", comment.id))}
                    </div>
                  </article>
                ))}
                {!comments.length && (
                  <p className="text-sm text-muted-foreground">
                    No published replies yet.
                  </p>
                )}
              </>
            )
          ) : (
            active && (
              <>
                {posts.map((item) => (
                  <article
                    key={item.id}
                    className="space-y-4 rounded-2xl border border-border bg-card p-5"
                  >
                    {author(item)}
                    {state(item)}
                    {(item.is_pinned || item.is_announcement) && (
                      <p className="text-xs font-semibold text-primary">
                        {item.is_pinned ? "Pinned · " : ""}
                        {item.is_announcement ? "Announcement" : ""}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{item.content}</p>
                    <CommunityMedia post={item} />
                    <div className="flex flex-wrap items-center gap-2">
                      {button(
                        `${item.liked_by_me ? "♥" : "♡"} ${item.like_count}`,
                        () => void like(item),
                        item.moderation_status !== "approved",
                      )}
                      <a
                        href={`/communities/${id}/posts/${item.id}`}
                        className={communityButton}
                      >
                        {item.comment_count} replies
                      </a>
                      <details className="ml-auto">
                        <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground">
                          Options
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.author_id === user?.id &&
                            button("Edit", () => setComposer({ post: item }))}
                          {leader &&
                            button(
                              item.is_pinned ? "Unpin" : "Pin",
                              () =>
                                void run("pin", {
                                  postId: item.id,
                                  pinned: !item.is_pinned,
                                }),
                            )}
                          {(leader || item.author_id === user?.id) &&
                            button("Delete", () => {
                              if (confirm("Delete this post and its replies?"))
                                void run("delete_post", { postId: item.id });
                            })}
                          {button("Report", () => report("post", item.id))}
                        </div>
                      </details>
                    </div>
                  </article>
                ))}
                {!posts.length && (
                  <p className="py-8 text-center text-muted-foreground">
                    No posts yet. Share something with your community.
                  </p>
                )}
                {hasMore &&
                  button(
                    loadingMore ? "Loading…" : "Load more posts",
                    () => void more(),
                    loadingMore,
                  )}
                {!!area.length && (
                  <section className="space-y-3">
                    <h2 className="font-semibold">More from the area</h2>
                    {area.map((item) => (
                      <a
                        key={item.id}
                        href={`/communities/${item.community_id}/posts/${item.id}`}
                        className="block rounded-xl border border-border p-4 text-sm"
                      >
                        {item.content}
                      </a>
                    ))}
                  </section>
                )}
              </>
            )
          )}
        </>
      )}
      {managing && community && (
        <CommunityManager
          community={community}
          role={role}
          onClose={() => setManaging(false)}
          onChanged={() => void load()}
        />
      )}
      {composer && (
        <CommunityComposer
          communityId={id}
          {...composer}
          canAnnounce={["staff", "owner", "admin"].includes(role)}
          onClose={() => setComposer(null)}
          onSaved={() => {
            setNotice(
              "Submitted for review. You can see your pending content here.",
            );
            void load();
          }}
        />
      )}
    </main>
  );
}
