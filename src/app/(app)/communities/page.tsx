"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { UsersThree, MagnifyingGlass, Lock, ArrowRight, SpinnerGap } from "@phosphor-icons/react";
import { CommunityService, Community } from "@/lib/community-service";
import { useAuth } from "@/hooks/use-supabase-auth";
import { cn } from "@/lib/utils";

export default function CommunitiesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<"mine" | "discover">("mine");
  const [query, setQuery] = useState("");
  const [myComms, setMyComms] = useState<Community[]>([]);
  const [discovered, setDiscovered] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [mine, disc] = await Promise.all([
      CommunityService.listMyCommunities().catch(() => []),
      CommunityService.discoverCommunities().catch(() => []),
    ]);
    setMyComms(mine);
    setDiscovered(disc);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSearch = (q: string) => {
    setQuery(q);
    CommunityService.discoverCommunities({ query: q }).then(setDiscovered).catch(() => {});
  };

  const list = tab === "mine" ? myComms : discovered;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Communities</h1>
          <p className="text-sm text-muted-foreground mt-1">Connect with your neighbourhood and interest groups</p>
        </div>
      </div>

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
