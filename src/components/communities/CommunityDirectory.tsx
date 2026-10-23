"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Plus, Search, Users, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  CommunityService,
  Community,
} from "@/lib/communities/community-service";
import { supabase } from "@/lib/supabase/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import {
  CommunityAvatar,
  communityButton,
  communityField,
  communityPrimaryButton,
  communityDialog,
} from "./CommunityTools";

export function CommunityDirectory({
  embedded = false,
  visible = true,
}: { embedded?: boolean; visible?: boolean } = {}) {
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
    if (!user?.id || !visible) return;
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
  }, [user?.id, profile?.home_state, debounced, visible]);
  useEffect(() => {
    setMine([]);
    setInvitations([]);
    setSubmissions([]);
    setDiscovered([]);
    setLoading(true);
  }, [user?.id]);
  useEffect(() => {
    if (!user?.id || !visible) return;
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
  }, [load, user?.id, visible]);
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
  const Container = embedded ? "section" : "main";
  const Heading = embedded ? "h2" : "h1";
  const awaiting = pendingNames.includes(
    name.trim().replace(/\s+/g, " ").toLowerCase(),
  );
  return (
    <Container
      aria-label={embedded ? "Community directory" : undefined}
      className={
        embedded
          ? "w-full min-w-0 space-y-6 pb-8 font-yrdly-body"
          : "mx-auto max-w-5xl space-y-6 px-4 py-8 pb-28 font-yrdly-body sm:px-6"
      }
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Your people, your place
          </p>
          <Heading className="font-yrdly-display text-3xl font-bold tracking-tight sm:text-4xl">
            Communities
          </Heading>
          <p className="mt-1 text-sm text-muted-foreground">
            Find your circle. Keep up with your neighbourhood.
          </p>
        </div>
        {profile?.phone_verified ? (
          <button
            className={communityPrimaryButton}
            onClick={() => setCreating(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Create
          </button>
        ) : (
          <a className={communityButton} href="/verify-phone">
            Verify to create
          </a>
        )}
      </header>
      {CommunityService.isStaffProfile(profile) && (
        <a
          href="/community-review"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
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
      <div className="space-y-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className={communityField + " pl-12"}
            aria-label="Search communities"
            placeholder={
              tab === "mine" ? "Search your communities" : "Find a community"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <nav
            aria-label="Community directory"
            className="flex min-w-0 flex-1 rounded-2xl border border-border bg-muted/50 p-1 sm:max-w-md"
          >
            {(
              [
                ["mine", "My communities"],
                ["discover", "Explore"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={
                  "min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
                  (tab === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            className={communityButton}
            onClick={() => void load()}
            aria-label="Refresh communities"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-yrdly-display text-xl font-semibold">
          {query
            ? "Search results"
            : tab === "mine"
              ? "Your communities"
              : "Find your people"}
        </h2>
        {!loading && (
          <span className="text-xs text-muted-foreground">
            {list.length} shown
          </span>
        )}
      </div>
      {loading ? (
        <p role="status">Loading communities…</p>
      ) : !list.length ? (
        <div className="space-y-4 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list.map((item) => (
            <Link
              key={item.id}
              href={`/communities/${item.id}`}
              className="group flex min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-card transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {item.banner_url && (
                <img
                  src={item.banner_url}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                  alt=""
                  loading="lazy"
                  className="h-32 w-full object-cover"
                />
              )}
              <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
                <div className="flex items-center gap-4">
                  <CommunityAvatar
                    name={item.name}
                    src={item.avatar_url}
                    className="h-16 w-16"
                  />
                  <div className="min-w-0">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {item.type === "ward"
                        ? "Your neighbourhood"
                        : item.type === "lga"
                          ? "Your local area"
                          : "Shared interest"}
                    </p>
                    <h3 className="break-words font-yrdly-display text-xl font-semibold leading-tight">
                      {item.name}
                    </h3>
                  </div>
                </div>
                {item.description && (
                  <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4 text-xs">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Users aria-hidden="true" className="h-4 w-4" />
                    {item.member_count}{" "}
                    {item.member_count === 1 ? "member" : "members"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 font-semibold text-primary">
                    {mine.some((joined) => joined.id === item.id)
                      ? "Joined"
                      : item.privacy === "invite"
                        ? "Invite only"
                        : item.privacy === "request"
                          ? "Request to join"
                          : "Explore"}
                    <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            </Link>
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
          <DialogContent className={communityDialog}>
            <DialogTitle className="font-yrdly-display text-2xl">
              Create a community
            </DialogTitle>
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
    </Container>
  );
}
