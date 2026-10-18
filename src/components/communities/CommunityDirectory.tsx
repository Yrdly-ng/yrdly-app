"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  CommunityService,
  Community,
} from "@/lib/communities/community-service";
import { supabase } from "@/lib/supabase/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { communityButton, communityField } from "./CommunityTools";

export function CommunityDirectory() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [tab, setTab] = useState<"mine" | "discover">("mine");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [mine, setMine] = useState<Community[]>([]);
  const [discovered, setDiscovered] = useState<Community[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<Community[]>([]);
  const [pendingNames, setPendingNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const page = useRef(0);
  const request = useRef(0);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<"open" | "request" | "invite">("open");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const load = useCallback(async () => {
    if (!user?.id) return;
    const started = ++request.current;
    setError("");
    try {
      const [memberships, directory, invites, submitted, names] =
        await Promise.all([
          CommunityService.listMyCommunities(),
          CommunityService.discoverCommunities({
            state: profile?.home_state || undefined,
            query: debounced,
          }),
          CommunityService.listInvitations(user.id),
          CommunityService.listMyCommunitySubmissions(user.id),
          CommunityService.pendingSubmissionNames(user.id),
        ]);
      if (started !== request.current) return;
      setMine(memberships);
      setDiscovered(directory);
      setInvitations(invites);
      setSubmissions(submitted);
      setPendingNames(names);
      setMore(directory.length === 30);
      page.current = 0;
    } catch (e: any) {
      if (started === request.current)
        setError(e.message || "Could not load communities.");
    } finally {
      if (started === request.current) setLoading(false);
    }
  }, [user?.id, profile?.home_state, debounced]);
  useEffect(() => {
    setMine([]);
    setInvitations([]);
    setSubmissions([]);
    setDiscovered([]);
    setLoading(true);
  }, [user?.id]);
  useEffect(() => {
    void load();
    const channel = supabase.channel(`web-community-directory-${user?.id}`);
    for (const table of [
      "communities",
      "community_invites",
      "community_memberships",
    ])
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => void load(),
      );
    channel.subscribe();
    const focus = () => void load();
    window.addEventListener("focus", focus);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      request.current++;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      void supabase.removeChannel(channel);
    };
  }, [load, user?.id]);
  const respond = async (cid: string, action: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await CommunityService.command(cid, action);
      await load();
      if (action === "accept_invite") router.push(`/communities/${cid}`);
    } catch (e: any) {
      setError(e.message || "Could not respond.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await CommunityService.submitCommunity({
        createdBy: user.id,
        name,
        description,
        privacy,
        avatarFile: avatar,
        bannerFile: banner,
      });
      setCreating(false);
      setName("");
      setDescription("");
      setAvatar(null);
      setBanner(null);
      await load();
    } catch (e: any) {
      setError(e.message || "Could not submit community.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const started = request.current;
    try {
      const next = await CommunityService.discoverCommunities({
        state: profile?.home_state || undefined,
        query: debounced,
        page: page.current + 1,
      });
      if (started !== request.current) return;
      setDiscovered((current) =>
        Array.from(
          new Map(
            [...current, ...next].map((item) => [item.id, item]),
          ).values(),
        ),
      );
      page.current++;
      setMore(next.length === 30);
    } catch (e: any) {
      setError(e.message || "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  };
  const list =
    tab === "mine"
      ? mine.filter((item) =>
          item.name.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : discovered;
  const awaiting = pendingNames.includes(
    name.trim().replace(/\s+/g, " ").toLowerCase(),
  );
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 pb-28">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Communities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find your neighbourhood and interest groups.
          </p>
        </div>
        {profile?.phone_verified ? (
          <button className={communityButton} onClick={() => setCreating(true)}>
            Create
          </button>
        ) : (
          <a className={communityButton} href="/verify-phone">
            Verify to create
          </a>
        )}
      </header>
      {CommunityService.isStaffProfile(profile) && (
        <a href="/community-review" className={communityButton}>
          Review community submissions
        </a>
      )}
      {!!error && !creating && (
        <div role="alert" className="text-sm text-red-500">
          {error}{" "}
          <button className={communityButton} onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {invitations.map((invite) => (
        <section
          key={invite.id}
          className="space-y-3 rounded-xl border border-primary/30 p-4"
        >
          <h2 className="font-semibold">
            Invitation: {invite.community?.name || "Community"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {invite.community?.description} · Expires{" "}
            {new Date(invite.expires_at).toLocaleDateString()}
          </p>
          <div className="flex gap-3">
            <button
              className={communityButton}
              disabled={busy}
              onClick={() => void respond(invite.community_id, "accept_invite")}
            >
              Accept
            </button>
            <button
              className={communityButton}
              disabled={busy}
              onClick={() =>
                void respond(invite.community_id, "decline_invite")
              }
            >
              Decline
            </button>
          </div>
        </section>
      ))}
      {!!submissions.length && (
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Your submissions ({submissions.length})
          </summary>
          <div className="mt-3 space-y-3">
            {submissions.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-sm font-medium">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {item.approval_status === "pending"
                    ? "Awaiting review"
                    : "Rejected"}
                </span>
                <button
                  className={communityButton}
                  onClick={() => {
                    if (!user) return;
                    void CommunityService.dismissCommunitySubmission(
                      item.id,
                      user.id,
                    )
                      .then(() =>
                        setSubmissions((current) =>
                          current.filter((row) => row.id !== item.id),
                        ),
                      )
                      .catch((e) => setError(e.message));
                  }}
                >
                  Dismiss
                </button>
                {item.rejection_reason && (
                  <p className="basis-full text-sm text-muted-foreground">
                    {item.rejection_reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      <input
        className={communityField}
        aria-label="Search communities"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <nav aria-label="Community directory" className="flex gap-3">
        <button
          className={communityButton + (tab === "mine" ? " bg-primary/10" : "")}
          onClick={() => setTab("mine")}
        >
          My Communities
        </button>
        <button
          className={
            communityButton + (tab === "discover" ? " bg-primary/10" : "")
          }
          onClick={() => setTab("discover")}
        >
          Discover
        </button>
        <button
          className={communityButton + " ml-auto"}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </nav>
      {loading ? (
        <p role="status">Loading communities…</p>
      ) : !list.length ? (
        <div className="space-y-4 py-8 text-center">
          <p className="text-muted-foreground">
            {query
              ? "No matching communities."
              : tab === "mine"
                ? "You haven’t joined any communities yet."
                : "No communities found."}
          </p>
          {tab === "mine" && (
            <button
              className={communityButton}
              onClick={() => setTab("discover")}
            >
              Browse communities
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((item) => (
            <a
              key={item.id}
              href={`/communities/${item.id}`}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:border-primary/50"
            >
              {item.avatar_url ? (
                <img
                  src={item.avatar_url}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl text-primary">
                  ♧
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold">
                  {item.name}
                  {item.privacy === "invite" ? " · Invite only" : ""}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {item.member_count} members ·{" "}
                  {item.type === "ward"
                    ? "Ward"
                    : item.type === "lga"
                      ? "LGA"
                      : "Group"}
                </p>
                {item.description && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {item.description}
                  </p>
                )}
              </div>
              <span aria-hidden>→</span>
            </a>
          ))}
        </div>
      )}
      {tab === "discover" && more && (
        <button
          className={communityButton}
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading…" : "Load more communities"}
        </button>
      )}
      {creating && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setCreating(false);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogTitle>Create a community</DialogTitle>
            <p className="text-sm text-muted-foreground">
              A YRDLY moderator reviews submissions before they go live.
            </p>
            <form onSubmit={create} className="space-y-4">
              <label className="block text-sm">
                Name
                <input
                  className={communityField}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
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
                  required
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
                Profile image (up to 10 MB)
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setAvatar(event.target.files?.[0] || null)
                  }
                />
              </label>
              <label className="block text-sm">
                Banner image (up to 10 MB)
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setBanner(event.target.files?.[0] || null)
                  }
                />
              </label>
              {!!error && (
                <p role="alert" className="text-sm text-red-500">
                  {error}
                </p>
              )}
              <button
                className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
                disabled={busy || awaiting}
              >
                {busy
                  ? "Submitting…"
                  : awaiting
                    ? "Awaiting approval"
                    : "Send for review"}
              </button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
