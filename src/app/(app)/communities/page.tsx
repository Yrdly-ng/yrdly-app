"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { UsersThree, MagnifyingGlass, Lock, ArrowRight, SpinnerGap, Plus, ShieldCheck } from "@phosphor-icons/react";
import { CommunityService, Community } from "@/lib/community-service";
import { useAuth } from "@/hooks/use-supabase-auth";
import { cn } from "@/lib/utils";

export default function CommunitiesPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [tab, setTab] = useState<"mine" | "discover">("mine");
  const [query, setQuery] = useState("");
  const [myComms, setMyComms] = useState<Community[]>([]);
  const [discovered, setDiscovered] = useState<Community[]>([]);
  const [submissions, setSubmissions] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const userState = (profile as any)?.home_state;
    const [mine, disc, submitted] = await Promise.all([
      CommunityService.listMyCommunities().catch(() => []),
      CommunityService.discoverCommunities({ state: userState }).catch(() => []),
      user ? CommunityService.listMyCommunitySubmissions(user.id).catch(() => []) : Promise.resolve([]),
    ]);
    setMyComms(mine);
    setDiscovered(disc);
    setSubmissions(submitted);
    setLoading(false);
  }, [profile, user]);

  useEffect(() => { load(); }, [load]);

  const onSearch = (q: string) => {
    setQuery(q);
    const userState = (profile as any)?.home_state;
    CommunityService.discoverCommunities({ state: userState, query: q }).then(setDiscovered).catch(() => {});
  };

  const list = tab === "mine" ? myComms : discovered;

  const submitCommunity = async (formData: FormData) => {
    if (!user) return;
    setSaving(true);
    setFormError("");
    try {
      await CommunityService.submitCommunity({
        createdBy: user.id,
        name: String(formData.get("name") || ""),
        description: String(formData.get("description") || ""),
        avatarUrl: String(formData.get("avatarUrl") || ""),
        bannerUrl: String(formData.get("bannerUrl") || ""),
        privacy: String(formData.get("privacy") || "open") as "open" | "request" | "invite",
      });
      setShowCreate(false);
      await load();
    } catch (error: any) {
      setFormError(error.message || "Could not submit this community.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Communities</h1>
          <p className="text-sm text-muted-foreground mt-1">Connect with your neighbourhood and interest groups</p>
        </div>
        {profile?.phone_verified ? (
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            <Plus size={16} /> Create
          </button>
        ) : (
          <button onClick={() => router.push("/onboarding/verify-phone")} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            <ShieldCheck size={16} /> Verify to create
          </button>
        )}
      </div>
      {(profile as any)?.role === "admin" || (profile as any)?.role === "moderator" || (profile as any)?.is_admin ? (
        <button onClick={() => router.push("/community-review")} className="mb-4 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground">Review community submissions</button>
      ) : null}

      {submissions.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground mb-2">Your submissions</h2>
          <div className="space-y-2">
            {submissions.map((submission) => (
              <div key={submission.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="truncate text-foreground">{submission.name}</span>
                <span className={cn("shrink-0 text-xs font-medium", submission.approval_status === "pending" ? "text-amber-500" : "text-red-500")}>
                  {submission.approval_status === "pending" ? "Awaiting review" : "Rejected"}
                </span>
                {submission.approval_status === "rejected" && submission.rejection_reason && <span className="basis-full text-xs text-muted-foreground">{submission.rejection_reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
          <form action={submitCommunity} className="w-full max-w-lg space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div>
              <h2 className="text-lg font-bold text-foreground">Create a community</h2>
              <p className="mt-1 text-sm text-muted-foreground">Our moderators review the name, description, and images before it appears.</p>
            </div>
            <label className="block text-sm text-foreground">Name<input name="name" required maxLength={60} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="block text-sm text-foreground">Description<textarea name="description" required maxLength={500} rows={3} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="block text-sm text-foreground">Profile image URL<input name="avatarUrl" type="url" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="https://…" /></label>
            <label className="block text-sm text-foreground">Banner image URL (optional)<input name="bannerUrl" type="url" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="https://…" /></label>
            <label className="block text-sm text-foreground">Who can join?<select name="privacy" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"><option value="open">Anyone</option><option value="request">By request</option><option value="invite">Invite only</option></select></label>
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg px-4 py-2 text-sm text-muted-foreground">Cancel</button><button disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Submitting…" : "Send for review"}</button></div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <input
          className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          placeholder="Search communities…"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border mb-6">
        {(["mine", "discover"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2.5 text-sm font-medium transition-colors border-b-2",
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "mine" ? "My Communities" : "Discover"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center pt-16">
          <SpinnerGap size={32} className="animate-spin text-primary" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center pt-16 gap-3 text-center">
          <UsersThree size={52} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-xs">
            {tab === "mine"
              ? "You haven't joined any communities yet. Discover one below."
              : "No communities found."}
          </p>
          {tab === "mine" && (
            <button onClick={() => setTab("discover")} className="text-sm text-primary font-medium mt-1">
              Browse communities →
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => router.push(`/communities/${c.id}`)}
              className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors text-left w-full"
            >
              {c.avatar_url ? (
                <img src={c.avatar_url} alt={c.name} className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <UsersThree size={22} className="text-primary" weight="fill" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm text-foreground truncate">{c.name}</span>
                  {c.privacy === "invite" && <Lock size={12} className="text-muted-foreground flex-shrink-0" weight="fill" />}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {c.member_count} {c.member_count === 1 ? "member" : "members"} ·{" "}
                  {c.type === "ward" ? "Ward" : c.type === "lga" ? "LGA" : "Group"}
                </p>
                {c.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{c.description}</p>
                )}
              </div>
              <ArrowRight size={16} className="text-muted-foreground flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
