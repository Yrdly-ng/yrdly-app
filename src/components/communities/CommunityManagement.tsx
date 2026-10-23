"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  CommunityService,
  Community,
} from "@/lib/communities/community-service";
import { useAuth } from "@/hooks/use-supabase-auth";
import {
  CommunityAvatar,
  communityField,
  communityButton,
  communityDialog,
} from "./CommunityTools";
import { supabase } from "@/lib/supabase/supabase";
import { useRouter } from "next/navigation";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { CommunityMedia } from "./CommunityMedia";
export function CommunityManager({
  community,
  role,
  onClose,
  onChanged,
}: {
  community: Community;
  role: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const leader = ["owner", "admin", "moderator", "staff"].includes(role);
  const settingsAllowed = ["owner", "admin", "staff"].includes(role);
  const [tab, setTab] = useState("members");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const inFlight = useRef(false);
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description || "");
  const [privacy, setPrivacy] = useState(community.privacy);
  const [rules, setRules] = useState((community.rules || []).join("\n"));
  const [avatar, setAvatar] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const load = useCallback(async () => {
    const started = ++request.current;
    setLoading(true);
    setError("");
    setPage(0);
    try {
      let data: any[] = [];
      if (tab === "members")
        data = await CommunityService.members(community.id, query);
      if (tab === "requests")
        data = await CommunityService.listJoinRequests(community.id);
      if (tab === "review") {
        data = await CommunityService.reviews(community.id);
        data = await Promise.all(
          data.map(async (review) => ({
            ...review,
            resolved_image_urls: await CommunityService.resolveMedia(
              review.image_urls || [],
            ),
            resolved_video_urls: await CommunityService.resolveMedia(
              review.video_urls || [],
            ),
          })),
        );
      }
      if (tab === "reports")
        data = await CommunityService.reports(community.id);
      if (tab === "invites") {
        data = await CommunityService.listPendingInvites(community.id);
        const found = await CommunityService.inviteCandidates(
          community.id,
          query,
        );
        if (started === request.current) setCandidates(found);
      }
      if (started === request.current) {
        setRows(data);
        setMore(tab === "members" && data.length === 50);
      }
    } catch (e: any) {
      if (started === request.current) setError(e.message || "Could not load.");
    } finally {
      if (started === request.current) setLoading(false);
    }
  }, [community.id, tab, query]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => {
      request.current++;
      clearTimeout(timer);
    };
  }, [load]);
  useEffect(() => {
    const channel = supabase.channel(`community-management-${community.id}`);
    for (const table of [
      "community_memberships",
      "community_join_requests",
      "community_invites",
      "community_content_reviews",
      "community_reports",
    ]) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `community_id=eq.${community.id}`,
        },
        () => void load(),
      );
    }
    channel.subscribe();
    const focus = () => void load();
    window.addEventListener("focus", focus);
    const mediaRefresh = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 240000);
    return () => {
      window.removeEventListener("focus", focus);
      clearInterval(mediaRefresh);
      void supabase.removeChannel(channel);
    };
  }, [community.id, load]);
  const run = async (action: string, data: Record<string, unknown> = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await CommunityService.command(community.id, action, data);
      await load();
      onChanged();
    } catch (e: any) {
      setError(e.message || "Could not complete action.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const saveSettings = async () => {
    if (inFlight.current || !user) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const avatarUrl = avatar
        ? await CommunityService.uploadCommunityImage(
            user.id,
            `${community.id}-${Date.now()}`,
            "avatar",
            avatar,
          )
        : community.avatar_url;
      const bannerUrl = banner
        ? await CommunityService.uploadCommunityImage(
            user.id,
            `${community.id}-${Date.now()}`,
            "banner",
            banner,
          )
        : community.banner_url;
      await CommunityService.command(community.id, "settings", {
        name,
        description,
        privacy,
        rules: rules
          .split("\n")
          .map((rule) => rule.trim())
          .filter(Boolean),
        avatarUrl,
        bannerUrl,
      });
      onChanged();
      setAvatar(null);
      setBanner(null);
    } catch (e: any) {
      setError(e.message || "Could not save.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const button = (label: string, callback: () => void, danger = false) => (
    <button
      type="button"
      disabled={busy}
      className={communityButton + (danger ? " text-red-500" : "")}
      onClick={callback}
    >
      {label}
    </button>
  );
  const sections: Record<string, { title: string; description: string }> = {
    members: {
      title: "Members",
      description:
        "The people in your community. View profiles and manage their roles.",
    },
    requests: {
      title: "Join requests",
      description:
        "Welcome new people. Review requests before they join the conversation.",
    },
    invites: {
      title: "Invitations",
      description:
        "Invite mutual friends and keep track of outstanding invitations.",
    },
    review: {
      title: "Post review",
      description:
        "Help keep your community welcoming. Review posts and edits awaiting approval.",
    },
    reports: {
      title: "Reports",
      description:
        "Review concerns raised by your community and resolve them with care.",
    },
    settings: {
      title: "Community settings",
      description:
        "Give your community its identity and set clear expectations for everyone.",
    },
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className={communityDialog + " max-w-3xl"}>
        <p className="pr-8 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {community.name}
        </p>
        <DialogTitle className="pr-8 font-yrdly-display text-2xl sm:text-3xl">
          {leader ? "Manage community" : "Community members"}
        </DialogTitle>
        <nav
          aria-label="Community management"
          className="flex gap-2 overflow-x-auto pb-2"
        >
          {(leader
            ? [
                "members",
                "requests",
                "invites",
                "review",
                "reports",
                ...(settingsAllowed ? ["settings"] : []),
              ]
            : ["members"]
          ).map((section) => (
            <button
              key={section}
              className={
                communityButton +
                " shrink-0 " +
                (tab === section
                  ? " border-primary/40 bg-primary/10 text-primary"
                  : "")
              }
              aria-pressed={tab === section}
              onClick={() => {
                setTab(section);
                setQuery("");
              }}
            >
              {sections[section].title}
            </button>
          ))}
        </nav>
        <div className="space-y-2 py-2">
          <h2 className="font-yrdly-display text-xl font-semibold">
            {sections[tab].title}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {sections[tab].description}
          </p>
        </div>
        {!!error && (
          <div role="alert" className="text-sm text-red-500">
            {error} {button("Try again", () => void load())}
          </div>
        )}
        {["members", "invites"].includes(tab) && (
          <input
            className={communityField}
            aria-label={
              tab === "members"
                ? "Find community members"
                : "Find mutual friends"
            }
            placeholder={
              tab === "members"
                ? "Search members by name"
                : "Search your mutual friends"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        {loading ? (
          <p role="status">Loading…</p>
        ) : tab === "settings" ? (
          <div className="space-y-3">
            <label className="block text-sm">
              Name
              <input
                className={communityField}
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={3}
                maxLength={60}
              />
            </label>
            <label className="block text-sm">
              Description
              <textarea
                className={communityField}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
              />
            </label>
            <label className="block text-sm">
              Who can join?
              <select
                className={communityField}
                value={privacy}
                onChange={(event) =>
                  setPrivacy(event.target.value as typeof privacy)
                }
              >
                <option value="open">Anyone</option>
                <option value="request">By request</option>
                <option value="invite">Invite only</option>
              </select>
            </label>
            <label className="block text-sm">
              Rules (one per line)
              <textarea
                className={communityField}
                value={rules}
                onChange={(event) => setRules(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              Profile image
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setAvatar(event.target.files?.[0] || null)}
              />
            </label>
            <label className="block text-sm">
              Banner image
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setBanner(event.target.files?.[0] || null)}
              />
            </label>
            {button(
              busy ? "Saving…" : "Save changes",
              () => void saveSettings(),
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {!rows.length && (
              <p className="text-sm text-muted-foreground">Nothing here yet.</p>
            )}
            {rows.map((row) => (
              <section
                key={row.id}
                className="space-y-4 rounded-3xl border border-border bg-card p-5"
              >
                {tab === "members" && (
                  <>
                    <a
                      href={`/profile/${row.user_id}`}
                      className="flex min-w-0 items-center gap-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <CommunityAvatar
                        name={row.user?.name}
                        src={row.user?.avatar_url}
                        className="h-14 w-14"
                      />
                      <div className="min-w-0">
                        <h3 className="flex items-center gap-1.5 break-words font-yrdly-display text-lg font-semibold">
                          {row.user?.name || "Member"}
                          {row.user?.phone_verified && (
                            <VerifiedBadge size={16} />
                          )}
                        </h3>
                        <p className="mt-1 text-sm capitalize text-muted-foreground">
                          {row.user_id === community.owner_id
                            ? "owner"
                            : row.role}{" "}
                          · {row.status}
                        </p>
                      </div>
                    </a>
                    {leader &&
                      row.user_id !== user?.id &&
                      row.user_id !== community.owner_id &&
                      (role === "staff" ||
                        role === "owner" ||
                        (role === "admin" && row.role !== "admin") ||
                        (role === "moderator" && row.role === "member")) && (
                        <div className="flex flex-wrap gap-2">
                          {row.status === "banned"
                            ? button(
                                "Lift ban",
                                () =>
                                  void run("unban", { userId: row.user_id }),
                              )
                            : row.status === "active" && (
                                <>
                                  {["owner", "staff"].includes(role) &&
                                    button(
                                      row.role === "admin"
                                        ? "Remove admin role"
                                        : "Make admin",
                                      () =>
                                        void run("role", {
                                          userId: row.user_id,
                                          role:
                                            row.role === "admin"
                                              ? "member"
                                              : "admin",
                                        }),
                                    )}
                                  {["owner", "admin", "staff"].includes(role) &&
                                    row.role !== "admin" &&
                                    button(
                                      row.role === "moderator"
                                        ? "Remove moderator role"
                                        : "Make moderator",
                                      () =>
                                        void run("role", {
                                          userId: row.user_id,
                                          role:
                                            row.role === "moderator"
                                              ? "member"
                                              : "moderator",
                                        }),
                                    )}
                                  {role === "owner" &&
                                    button("Offer ownership", () => {
                                      if (
                                        confirm(
                                          "Offer this member ownership? They must accept before it changes.",
                                        )
                                      )
                                        void run("offer_ownership", {
                                          userId: row.user_id,
                                        });
                                    })}
                                  {button(
                                    "Remove",
                                    () => {
                                      if (confirm("Remove this member?"))
                                        void run("remove", {
                                          userId: row.user_id,
                                        });
                                    },
                                    true,
                                  )}
                                  {button(
                                    "Ban",
                                    () => {
                                      if (confirm("Ban this member?"))
                                        void run("ban", {
                                          userId: row.user_id,
                                        });
                                    },
                                    true,
                                  )}
                                  {role === "staff" &&
                                    !community.owner_id &&
                                    community.type === "interest" &&
                                    button(
                                      "Assign owner",
                                      () =>
                                        void run("staff_recover", {
                                          userId: row.user_id,
                                        }),
                                    )}
                                </>
                              )}
                        </div>
                      )}
                  </>
                )}
                {tab === "requests" && (
                  <>
                    <div className="flex items-center gap-3">
                      <CommunityAvatar
                        name={row.user?.name}
                        src={row.user?.avatar_url}
                      />
                      <h3 className="font-semibold">
                        {row.user?.name || "Join request"}
                      </h3>
                    </div>
                    <p className="text-sm">{row.message}</p>
                    <div className="flex gap-2">
                      {button(
                        "Approve",
                        () =>
                          void run("review_request", {
                            userId: row.user_id,
                            decision: "approved",
                          }),
                      )}
                      {button(
                        "Reject",
                        () =>
                          void run("review_request", {
                            userId: row.user_id,
                            decision: "rejected",
                          }),
                        true,
                      )}
                    </div>
                  </>
                )}
                {tab === "invites" && (
                  <>
                    <div className="flex items-center gap-3">
                      <CommunityAvatar
                        name={row.recipient?.name}
                        src={row.recipient?.avatar_url}
                      />
                      <h3 className="font-semibold">
                        {row.recipient?.name || "Invited friend"}
                      </h3>
                    </div>
                    <p className="text-sm">
                      Expires {new Date(row.expires_at).toLocaleDateString()}
                    </p>
                    {button(
                      "Revoke invitation",
                      () =>
                        void run("revoke_invite", {
                          userId: row.invited_user_id,
                        }),
                      true,
                    )}
                  </>
                )}
                {tab === "review" && (
                  <>
                    <h3 className="font-semibold">
                      {row.is_revision
                        ? "Edited content awaiting review"
                        : "Content awaiting review"}
                    </h3>
                    <p className="whitespace-pre-wrap">{row.content}</p>
                    <CommunityMedia post={row} />
                    <p className="text-sm text-muted-foreground">
                      {row.reason || "Awaiting moderation"}
                    </p>
                    <div className="flex gap-2">
                      {button(
                        "Approve",
                        () =>
                          void run("review_content", {
                            reviewId: row.id,
                            decision: "approved",
                          }),
                      )}
                      {button(
                        "Reject",
                        () =>
                          void run("review_content", {
                            reviewId: row.id,
                            decision: "rejected",
                            reason: "Does not meet community rules.",
                          }),
                        true,
                      )}
                    </div>
                  </>
                )}
                {tab === "reports" && (
                  <>
                    <h3 className="font-semibold">Reported {row.kind}</h3>
                    <p>{row.reason}</p>
                    <div className="flex flex-wrap gap-2">
                      {button("View content", () => {
                        if (row.kind === "post") {
                          onClose();
                          router.push(
                            `/communities/${community.id}/posts/${row.target_id}`,
                          );
                        } else
                          void supabase
                            .from("community_comments")
                            .select("post_id")
                            .eq("id", row.target_id)
                            .maybeSingle()
                            .then((result) => {
                              if (result.data) {
                                onClose();
                                router.push(
                                  `/communities/${community.id}/posts/${result.data.post_id}`,
                                );
                              } else setError("Reply is no longer available.");
                            });
                      })}
                      {button(
                        "Remove content",
                        () => {
                          if (confirm("Remove reported content?"))
                            void run(
                              row.kind === "post"
                                ? "delete_post"
                                : "delete_comment",
                              { targetId: row.target_id, kind: row.kind },
                            );
                        },
                        true,
                      )}
                      {button(
                        "Mark resolved",
                        () => void run("resolve_report", { reportId: row.id }),
                      )}
                    </div>
                  </>
                )}
              </section>
            ))}
            {more &&
              button("Load more members", () => {
                setLoading(true);
                void CommunityService.members(community.id, query, page + 1)
                  .then((data) => {
                    setRows((current) => [...current, ...data]);
                    setPage(page + 1);
                    setMore(data.length === 50);
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setLoading(false));
              })}
            {tab === "invites" && (
              <section className="space-y-3">
                <h3 className="font-semibold">Invite mutual friends</h3>
                {!candidates.length && (
                  <p className="text-sm text-muted-foreground">
                    No eligible mutual friends found.
                  </p>
                )}
                {candidates.map((friend) => (
                  <div
                    key={friend.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <CommunityAvatar
                        name={friend.name}
                        src={friend.avatar_url}
                      />
                      <span className="break-words font-semibold">
                        {friend.name}
                      </span>
                    </div>
                    {button(
                      "Invite",
                      () => void run("invite", { userId: friend.id }),
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
