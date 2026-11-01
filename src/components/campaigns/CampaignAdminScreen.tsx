"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { CampaignAdminResponse } from "@/lib/campaigns/types";
import { campaignRequest } from "./CampaignScreen";

const endpoint = "/api/admin/campaigns/small-businesses";
const dateTime = (value: string) => new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos",
}).format(new Date(value));

export function CampaignAdminScreen() {
  const { user } = useAuth();
  const userId = user?.id;
  const [data, setData] = useState<CampaignAdminResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!userId) return;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await campaignRequest<CampaignAdminResponse>(endpoint, userId, signal);
      if (signal?.aborted || id !== requestId.current) return;
      setData(result);
      setError("");
    } catch (cause) {
      if (!signal?.aborted && id === requestId.current)
        setError(cause instanceof Error ? cause.message : "Could not load campaign sales.");
    } finally {
      if (!signal?.aborted && id === requestId.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    const controller = new AbortController();
    const requestCounter = requestId;
    void refresh(controller.signal);
    return () => { controller.abort(); requestCounter.current++; };
  }, [refresh]);

  const businesses = data?.participants || [];
  const sales = data?.sales || [];
  const qualifyingSales = sales.filter((sale) => sale.qualified).length;
  const needsReview = sales.filter((sale) => sale.reviewRequired).length;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Campaign monitor</p>
          <h1 className="mt-2 font-yrdly-display text-3xl font-bold">Businesses and sales</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Eligible Businessplace product businesses enter automatically. This page shows their recorded sales and current counts.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50">
          <RefreshCw size={16} className={loading ? "motion-safe:animate-spin" : ""} aria-hidden="true" />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      {error && <p role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm">{error}</p>}
      {!data && loading && <p role="status">Loading businesses and sales…</p>}
      {data && (
        <>
          <section aria-label="Campaign totals" className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border p-4"><p className="text-sm text-muted-foreground">Businesses</p><p className="mt-1 text-2xl font-bold">{businesses.length}</p></div>
            <div className="rounded-2xl border border-border p-4"><p className="text-sm text-muted-foreground">Completed sales</p><p className="mt-1 text-2xl font-bold">{qualifyingSales}</p></div>
            <div className="rounded-2xl border border-border p-4"><p className="text-sm text-muted-foreground">Sales to check</p><p className="mt-1 text-2xl font-bold">{needsReview}</p></div>
          </section>
          <p className="text-xs text-muted-foreground">Updated {dateTime(data.snapshot.updatedAt)} · Nigeria time</p>
          <section className="space-y-3" aria-labelledby="businesses-title">
            <h2 id="businesses-title" className="font-yrdly-display text-2xl font-bold">Business standings</h2>
            {businesses.length ? businesses.map((business) => {
              const count = sales.filter((sale) => sale.businessId === business.businessId && sale.qualified).length;
              return <Link key={business.businessId} href={`/businesses/${encodeURIComponent(business.businessId)}`} className="flex min-h-14 flex-wrap items-center gap-3 rounded-xl border border-border p-4 hover:bg-muted/50">
                <span className="min-w-0 flex-1 font-semibold">{business.name}</span>
                <span className="text-sm text-muted-foreground">{count} completed {count === 1 ? "sale" : "sales"}</span>
                <span className="text-sm text-primary">View business</span>
              </Link>;
            }) : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No eligible Businessplace businesses yet.</p>}
          </section>
          <section className="space-y-3" aria-labelledby="sales-title">
            <h2 id="sales-title" className="font-yrdly-display text-2xl font-bold">Recorded product sales</h2>
            {sales.length ? <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-muted/50"><tr><th className="p-3">Business</th><th className="p-3">Order placed</th><th className="p-3">Counted?</th><th className="p-3">Reason</th></tr></thead>
              <tbody>{sales.map((sale) => <tr key={sale.transactionId} className="border-t border-border"><td className="p-3">{sale.businessName}</td><td className="p-3">{dateTime(sale.createdAt)}</td><td className="p-3">{sale.qualified ? "Yes · +1" : sale.reviewRequired ? "Being checked" : "No"}</td><td className="max-w-sm p-3 text-muted-foreground">{sale.reason}</td></tr>)}</tbody>
            </table></div> : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No product orders have been recorded for this campaign yet.</p>}
          </section>
        </>
      )}
    </main>
  );
}
