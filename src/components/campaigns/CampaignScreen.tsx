"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  RefreshCw,
  Share2,
  Store,
  Trophy,
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase/supabase";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { CampaignEntry, CampaignMeResponse } from "@/lib/campaigns/types";
import { CampaignRules } from "./CampaignRules";

const endpoint = "/api/campaigns/small-businesses";
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
const statusCopy = {
  upcoming: [
    "Coming 1 November",
    "Create your Businessplace product business and it will be included automatically.",
  ],
  active: [
    "The campaign is on",
    "Eligible Businessplace businesses are already in. Every completed product sale adds one.",
  ],
  review: [
    "Sales window closed",
    "Results are under review. No winner has been announced.",
  ],
  finalized: [
    "Reviewed final results",
    "The November sales window has ended. See the verified standings below.",
  ],
} as const;

export async function campaignRequest<T>(
  path: string,
  userId: string,
  signal?: AbortSignal,
  body?: unknown,
): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId)
    throw new Error(
      "Please sign in again to view your campaign participation.",
    );
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      payload?.error ||
        "Campaign information is unavailable. Please try again.",
    );
  if (!payload)
    throw new Error("Campaign information is unavailable. Please try again.");
  return payload as T;
}

function BusinessResult({
  entry,
  own = false,
}: {
  entry: CampaignEntry;
  own?: boolean;
}) {
  return (
    <Link
      href={`/businesses/${encodeURIComponent(entry.businessId)}`}
      className={`flex min-h-20 items-center gap-3 rounded-2xl px-3 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:gap-5 sm:px-5 ${own ? "border-2 border-primary bg-primary/10" : "border border-border bg-card hover:bg-muted/50"}`}
    >
      <span
        className="w-10 shrink-0 text-center font-yrdly-display text-2xl font-bold tabular-nums"
        aria-label={`Rank ${entry.rank}`}
      >
        {entry.rank}
      </span>
      <Avatar className="h-11 w-11 shrink-0">
        <AvatarImage src={entry.logoUrl || undefined} alt="" />
        <AvatarFallback>{entry.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold sm:text-base">
          {entry.name}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Businessplace{own ? " · Your business" : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-yrdly-display text-2xl font-bold tabular-nums">
          {entry.completedSales.toLocaleString("en-NG")}
        </p>
        <p className="text-[11px] text-muted-foreground sm:text-xs">
          completed sales
        </p>
      </div>
    </Link>
  );
}

export function CampaignDashboard({
  data,
  error,
  refreshing,
  onRefresh,
  children,
}: {
  data: CampaignMeResponse | null;
  error: string;
  refreshing: boolean;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  const state = data ? statusCopy[data.campaign.status] : null;
  return (
    <>
      <section
        aria-labelledby="participation-title"
        className="rounded-3xl border border-border bg-card p-5 sm:p-7"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Your next move
        </p>
        <h2
          id="participation-title"
          className="mt-2 font-yrdly-display text-2xl font-bold"
        >
          {state?.[0] || "Your campaign participation"}
        </h2>
        {state && (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {state[1]}
          </p>
        )}
        {data?.campaign.integrityReviewRequired && (
          <p
            role="status"
            className="mt-4 rounded-xl border border-amber-500/40 p-3 text-sm"
          >
            New evidence requires an additional integrity review. No prize
            action follows automatically from these results.
          </p>
        )}
        {children}
      </section>

      <section
        id="leaderboard"
        aria-labelledby="leaderboard-title"
        className="space-y-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Count the sales. Make your move.
            </p>
            <h2
              id="leaderboard-title"
              className="mt-2 font-yrdly-display text-3xl font-bold"
            >
              The leaderboard<span className="text-primary">.</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={refreshing ? "motion-safe:animate-spin" : ""}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Ranked by completed-sale count. A bigger order value never means a
          higher rank.
        </p>
        {error && (
          <div
            role="alert"
            className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
          >
            {data
              ? "Showing the last successful update; these results may be stale. "
              : "Scores could not be loaded. "}
            {error}
          </div>
        )}
        {!data && refreshing && (
          <div
            role="status"
            aria-live="polite"
            className="space-y-3 rounded-2xl border border-border p-5"
          >
            <p>Loading campaign standings…</p>
            <div className="h-16 rounded-xl bg-muted motion-safe:animate-pulse" />
            <div className="h-16 rounded-xl bg-muted motion-safe:animate-pulse" />
          </div>
        )}
        {!data && !refreshing && !error && (
          <p role="status">
            Campaign standings are not available yet. Refresh to try again.
          </p>
        )}
        {data && (
          <>
            <p
              className="text-xs leading-6 text-muted-foreground"
              role="status"
            >
          {data.snapshot.provisional
                ? "Provisional standings"
                : "Reviewed final standings"}{" "}
              · {data.snapshot.participantCount} participating{" "}
              {data.snapshot.participantCount === 1 ? "business" : "businesses"}{" "}
              · Calculated{" "}
              <time dateTime={data.snapshot.updatedAt}>
                {dateTime(data.snapshot.updatedAt)}
              </time>{" "}
              Nigeria time
            </p>
            {data.ownEntries.some(
              (ownEntry) => !data.snapshot.entries.some((entry) => entry.businessId === ownEntry.businessId),
            ) && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">
                  Your businesses, wherever they rank
                </h3>
                {data.ownEntries.filter((ownEntry) => !data.snapshot.entries.some((entry) => entry.businessId === ownEntry.businessId)).map((entry) => (
                  <BusinessResult key={entry.businessId} entry={entry} own />
                ))}
              </div>
            )}
            {data.snapshot.entries.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border p-8 text-center">
                <Store
                  className="mx-auto mb-3 text-primary"
                  size={30}
                  aria-hidden="true"
                />
                <h3 className="font-yrdly-display text-xl font-bold">
                  {data.snapshot.participantCount === 0
                    ? "The starting line is open."
                    : "No standings in this update."}
                </h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  {data.snapshot.participantCount === 0
                    ? "Businessplace product businesses will appear here automatically."
                    : "Refresh shortly to see the latest business and sale counts."}
                </p>
              </div>
            ) : (
              <ol
                className="space-y-2"
                aria-label="Businesses ranked by completed sales"
              >
                {data.snapshot.entries.map((entry) => (
                  <li key={entry.businessId}>
                    <BusinessResult
                      entry={entry}
                      own={data.ownEntries.some((ownEntry) => ownEntry.businessId === entry.businessId)}
                    />
                  </li>
                ))}
              </ol>
            )}
            {data.snapshot.entries.length > 0 &&
              data.snapshot.entries.every(
                (entry) => entry.completedSales === 0,
              ) && (
                <p className="rounded-xl bg-muted p-4 text-sm">
                  These businesses are ready to compete. No qualifying completed
                  sales are recorded in this update.
                </p>
              )}
            <p className="text-xs leading-6 text-muted-foreground">
              Top {data.snapshot.entries.length} shown. Equal counts share rank.
              Your own rank comes from this same update, even outside the
              leading results.
            </p>
          </>
        )}
      </section>
    </>
  );
}

export function CampaignScreen() {
  const { user } = useAuth();
  const userId = user?.id;
  const identity = useRef(userId);
  const sequence = useRef(0);
  const [result, setResult] = useState<{
    userId: string;
    data: CampaignMeResponse;
  } | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [shareMessage, setShareMessage] = useState("");
  const data = result && result.userId === userId ? result.data : null;

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!userId) return;
      const request = ++sequence.current;
      setRefreshing(true);
      try {
        const next = await campaignRequest<CampaignMeResponse>(
          `${endpoint}/me`,
          userId,
          signal,
        );
        if (
          signal?.aborted ||
          request !== sequence.current ||
          identity.current !== userId
        )
          return;
        setResult({ userId, data: next });
        setError("");
      } catch (cause) {
        if (
          !signal?.aborted &&
          request === sequence.current &&
          identity.current === userId
        )
          setError(
            cause instanceof Error ? cause.message : "Please try again.",
          );
      } finally {
        if (
          !signal?.aborted &&
          request === sequence.current &&
          identity.current === userId
        )
          setRefreshing(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    identity.current = userId;
    setResult(null);
    setError("");
    const controller = new AbortController();
    const requests = sequence;
    void refresh(controller.signal);
    const visibleRefresh = () => {
      if (document.visibilityState === "visible")
        void refresh(controller.signal);
    };
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    const interval = window.setInterval(visibleRefresh, 60_000);
    return () => {
      controller.abort();
      requests.current++;
      window.clearInterval(interval);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh, userId]);

  const share = async () => {
    const url = "https://yrdly.ng/campaigns/small-businesses";
    try {
      if (navigator.share)
        await navigator.share({
          title: "YRDLY × Small Businesses",
          text: "Sell More. Win Big. ₦500,000 for first place. 1–30 November 2026.",
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        setShareMessage("Campaign link copied.");
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        setShareMessage(`Share this campaign: ${url}`);
    }
  };
  const closed =
    data?.campaign.status === "review" || data?.campaign.status === "finalized";
  return (
    <main className="mx-auto max-w-5xl space-y-7 px-4 py-6 pb-28 font-yrdly-body text-foreground sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/businesses"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
        >
          <ArrowLeft size={17} aria-hidden="true" /> Businessplace
        </Link>
        <button
          type="button"
          onClick={() => void share()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold"
        >
          <Share2 size={16} aria-hidden="true" /> Share campaign
        </button>
      </div>
      {shareMessage && (
        <p role="status" className="break-words text-sm">
          {shareMessage}
        </p>
      )}
      <section className="relative isolate overflow-hidden rounded-[2rem] bg-[#f5df16] text-[#102e1c]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-14 -top-14 h-60 w-60 rounded-full border-[32px] border-[#17623b]/10"
        />
        <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr] lg:p-12">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.17em]">
              YRDLY × Small Businesses
            </p>
            <p className="mt-3 inline-flex rounded-full border border-[#103b24]/40 px-3 py-1.5 text-xs font-semibold">
              1–30 November 2026 · Nigeria time
            </p>
            <h1 className="mt-6 font-yrdly-display text-5xl font-extrabold leading-[0.98] tracking-tight sm:text-7xl">
              Sell More.
              <br />
              <span className="text-[#17623b]">Win Big.</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-7">
              Your products. Your customers. Your climb to the top. Turn
              completed Businessplace sales into a shot at first place.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="#how-to-climb"
                className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#103b24] px-6 font-semibold text-white"
              >
                Create your business <ArrowUpRight size={18} aria-hidden="true" />
              </a>
              <a
                href="#leaderboard"
                className="inline-flex min-h-12 items-center rounded-full border border-[#103b24] px-6 font-semibold"
              >
                See the standings
              </a>
            </div>
          </div>
          <div className="flex flex-col justify-center rounded-[1.5rem] bg-[#103b24] p-6 text-[#f5df16] sm:p-8">
            <Trophy size={40} strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-6 text-sm font-bold uppercase tracking-widest">
              ₦500,000 Up For Grabs!
            </p>
            <p className="mt-3 font-yrdly-display text-5xl font-extrabold tracking-tight sm:text-6xl">
              ₦500,000
            </p>
            <p className="mt-3 text-lg font-semibold text-white">
              For first place.
            </p>
            <p className="mt-5 border-t border-white/20 pt-5 text-sm leading-7 text-white/85">
              Most completed sales wins. Not the highest naira value. Verified
              ties for first place share the prize equally.
            </p>
          </div>
        </div>
        <p className="border-t border-[#103b24]/20 px-6 py-4 text-sm font-bold tracking-widest sm:px-10">
          JOIN. SELL. CLIMB. WIN.
        </p>
      </section>
      <div id="how-to-climb" className="grid gap-3 sm:grid-cols-3">
        {[
          ["01", "Create", "Add your products to Businessplace. Your eligible business joins automatically."],
          [
            "02",
            "Sell",
            "Create and complete qualifying product orders in November.",
          ],
          ["03", "Climb", "Every qualifying completed order counts once."],
        ].map(([number, title, description]) => (
          <div
            key={number}
            className="rounded-2xl border border-border bg-card p-5"
          >
            <p className="text-xs font-bold text-primary">{number}</p>
            <h2 className="mt-2 font-yrdly-display text-xl font-bold">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
        ))}
      </div>
      <div id="participate" className="scroll-mt-24 space-y-7">
        <CampaignDashboard
          data={data}
          error={error}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
        >
          {data && data.businesses.length > 0 ? (
            <div className="mt-5 space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">
                Your eligible Businessplace businesses are included automatically. Every completed product sale adds one to the count.
              </p>
              {data.businesses.map((business) => (
                <Link key={business.id} href={`/businesses/${encodeURIComponent(business.id)}`} className="flex min-h-12 items-center gap-3 rounded-xl border border-border p-3 text-sm font-semibold hover:bg-muted/50">
                  <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={business.logoUrl || undefined} alt="" /><AvatarFallback>{business.name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1 truncate">{business.name}</span>
                  <span className="text-primary">View business</span>
                </Link>
              ))}
            </div>
          ) : data && !closed ? (
            <div className="mt-5 space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">
                Create a product business in Businessplace and it will be included automatically.
              </p>
              <Link href="/businesses?create=1" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground">
                <Store size={18} aria-hidden="true" /> Create your business
              </Link>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              The November sales period is over. You can still view the standings and your business profiles.
            </p>
          )}
        </CampaignDashboard>
      </div>
      <CampaignRules />
    </main>
  );
}
