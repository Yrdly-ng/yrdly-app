"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { CampaignAdminResponse } from "@/lib/campaigns/types";
import { CampaignPrizeRecords } from "./CampaignPrizeRecords";
import { campaignRequest } from "./CampaignScreen";

const endpoint = "/api/admin/campaigns/small-businesses";
type ReviewAction = {
  path: string;
  action?: string;
  title: string;
  subject: string;
  final?: boolean;
  expectedSnapshotId?: string;
};
const timestamp = (value: string) =>
  new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
const control =
  "min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

export function CampaignAdminScreen() {
  const { user } = useAuth();
  const userId = user?.id;
  const identity = useRef(userId);
  const [result, setResult] = useState<{
    userId: string;
    data: CampaignAdminResponse;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const data = result && result.userId === userId ? result.data : null;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!userId) return;
      const request = ++revision.current;
      setLoading(true);
      try {
        const next = await campaignRequest<CampaignAdminResponse>(
          endpoint,
          userId,
          signal,
        );
        if (
          !signal?.aborted &&
          request === revision.current &&
          identity.current === userId
        ) {
          setResult({ userId, data: next });
          setError("");
        }
      } catch (cause) {
        if (
          !signal?.aborted &&
          request === revision.current &&
          identity.current === userId
        )
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load campaign review.",
          );
      } finally {
        if (
          !signal?.aborted &&
          request === revision.current &&
          identity.current === userId
        )
          setLoading(false);
      }
    },
    [userId],
  );
  useEffect(() => {
    identity.current = userId;
    setResult(null);
    setPending(null);
    setReason("");
    setReviewed(false);
    setNotice("");
    setError("");
    const controller = new AbortController();
    const requests = revision;
    void refresh(controller.signal);
    return () => {
      controller.abort();
      requests.current++;
    };
  }, [refresh, userId]);
  const choose = (action: ReviewAction) => {
    setPending(action);
    setReason("");
    setReviewed(false);
    setNotice("");
  };
  const save = async () => {
    if (
      !userId ||
      !pending ||
      !data ||
      saving ||
      reason.trim().length < 10 ||
      (pending.final && !reviewed)
    )
      return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await campaignRequest(pending.path, userId, undefined, {
        ...(pending.action ? { action: pending.action } : {}),
        reason: reason.trim(),
        ...(pending.final
          ? { expectedSnapshotId: pending.expectedSnapshotId }
          : {}),
      });
      if (identity.current !== userId) return;
      setPending(null);
      setReason("");
      setReviewed(false);
      setNotice("Decision recorded in the campaign audit history.");
      await refresh();
    } catch (cause) {
      if (identity.current === userId)
        setError(
          cause instanceof Error
            ? cause.message
            : "The decision could not be saved. Refresh before retrying.",
        );
    } finally {
      if (identity.current === userId) setSaving(false);
    }
  };
  const disabled =
    loading ||
    saving ||
    !!error ||
    !data ||
    data.campaign.status === "finalized";
  return (
    <main className="mx-auto max-w-6xl space-y-7 px-4 py-6 pb-28 font-yrdly-body text-foreground sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
            <ShieldCheck size={17} aria-hidden="true" /> Campaign administration
          </p>
          <h1 className="mt-3 font-yrdly-display text-3xl font-bold">
            Review the climb.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Approve participants, inspect sale evidence and record decisions.
            Counts are calculated from qualifying orders; there is no editable
            score.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/campaigns/small-businesses"
            className={`${control} inline-flex items-center gap-2`}
          >
            Campaign <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className={`${control} inline-flex items-center gap-2`}
            disabled={loading || saving}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {loading ? "Refreshing…" : "Refresh evidence"}
          </button>
        </div>
      </header>
      {loading && !data && (
        <p role="status" className="rounded-2xl border border-border p-6">
          Loading private campaign evidence…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-destructive/40 p-4 text-sm"
        >
          {data
            ? "Evidence may be stale. Refresh before taking another action. "
            : ""}
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm"
        >
          {notice}
        </p>
      )}
      {data && (
        <>
          <section className="rounded-3xl bg-[#103b24] p-5 text-white sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#f5df16]">
              {data.campaign.status} · Rules {data.campaign.rulesVersion}
            </p>
            <h2 className="mt-2 font-yrdly-display text-2xl font-bold">
              November Businessplace product campaign
            </h2>
            <p className="mt-3 text-sm leading-6">
              ₦500,000 for first place · Ranked by completed orders · Verified
              first-place ties split the prize
            </p>
            <p className="mt-3 text-xs leading-6 text-white/80">
              Evidence calculated {timestamp(data.snapshot.updatedAt)} Nigeria
              time. Review period ends {timestamp(data.campaign.reviewEndsAt)}.
            </p>
            <p className="mt-2 break-all text-xs text-white/70">
              Snapshot: {data.snapshot.id}
            </p>
            {data.campaign.integrityReviewRequired && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-[#f5df16] p-3 text-sm"
              >
                Additional integrity review required. Inspect new evidence
                before any winner or prize action.
              </p>
            )}
          </section>

          {pending && (
            <section
              className="scroll-mt-24 rounded-3xl border-2 border-primary bg-card p-5"
              aria-labelledby="decision-title"
            >
              <h2
                id="decision-title"
                className="font-yrdly-display text-xl font-bold"
              >
                {pending.title}
              </h2>
              <p className="mt-2 break-words text-sm text-muted-foreground">
                {pending.subject}
              </p>
              <label
                htmlFor="campaign-review-reason"
                className="mt-4 block text-sm font-semibold"
              >
                Reason and supporting evidence
              </label>
              <textarea
                id="campaign-review-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={saving}
                minLength={10}
                maxLength={1000}
                rows={4}
                placeholder="Describe the evidence and why this decision is justified."
                className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-base"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                At least 10 characters. Your account, time, subject and reason
                are recorded.
              </p>
              {pending.final && (
                <label className="mt-4 flex min-h-11 items-start gap-3 text-sm leading-6">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.target.checked)}
                    disabled={saving}
                    className="mt-1 h-5 w-5 shrink-0"
                  />
                  <span>
                    I have reviewed the participants, sales, outstanding cases
                    and this exact result snapshot. Saving final results does
                    not announce a winner or issue a prize.
                  </span>
                </label>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={`${control} bg-primary text-primary-foreground`}
                  disabled={
                    saving ||
                    loading ||
                    !!error ||
                    reason.trim().length < 10 ||
                    (!!pending.final && !reviewed)
                  }
                  onClick={() => void save()}
                >
                  {saving ? "Recording…" : "Record decision"}
                </button>
                <button
                  type="button"
                  className={control}
                  disabled={saving}
                  onClick={() => setPending(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

          <section aria-labelledby="participants-title" className="space-y-3">
            <h2
              id="participants-title"
              className="font-yrdly-display text-2xl font-bold"
            >
              Participants
            </h2>
            {data.participants.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                No applications yet.
              </p>
            )}
            {data.participants.map((participant) => (
              <article
                key={participant.id}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/businesses/${encodeURIComponent(participant.businessId)}`}
                      className="break-words font-semibold underline underline-offset-4"
                    >
                      {participant.name}
                    </Link>
                    <p className="mt-2 text-sm capitalize">
                      {participant.status}
                    </p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      Owner: {participant.ownerId}
                    </p>
                    {participant.approvedAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Approved {timestamp(participant.approvedAt)}
                      </p>
                    )}
                    {participant.reason && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Latest reason: {participant.reason}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      ["approve", "reject", "suspend", "disqualify"] as const
                    ).map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={disabled}
                        className={`${control} capitalize`}
                        onClick={() =>
                          choose({
                            path: `${endpoint}/participants/${encodeURIComponent(participant.id)}`,
                            action,
                            title: `${action === "approve" ? "Approve" : action === "reject" ? "Reject" : action === "disqualify" ? "Disqualify" : "Suspend"} participation`,
                            subject: participant.name,
                          })
                        }
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </section>

          <section aria-labelledby="sale-evidence-title" className="space-y-3">
            <h2
              id="sale-evidence-title"
              className="font-yrdly-display text-2xl font-bold"
            >
              Sale evidence
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Holding a sale removes it from qualification until reviewed.
              Clearing a manual hold never overrides payment, fulfillment, date,
              refund or eligibility rules.
            </p>
            {data.sales.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                No campaign sale evidence has been recorded.
              </p>
            )}
            {data.sales.map((sale) => (
              <article
                key={sale.transactionId}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words font-semibold">
                      {sale.businessName}
                    </h3>
                    <p className="mt-2 text-sm font-semibold">
                      {sale.qualified ? "Qualifies" : "Excluded or held"} ·{" "}
                      {sale.environment}
                      {sale.reviewRequired ? " · Review required" : ""}
                    </p>
                    <p className="mt-2 break-words text-sm text-muted-foreground">
                      {sale.reason.replace(/_/g, " ")}
                    </p>
                    {(sale.suspicionSignals || []).length > 0 && (
                      <p className="mt-3 rounded-xl border border-amber-500/40 p-3 text-sm">
                        Review indicators:{" "}
                        {sale.suspicionSignals
                          .map((signal) => signal.replace(/_/g, " "))
                          .join("; ")}
                        . Indicators are not a finding of abuse.
                      </p>
                    )}
                    {(sale.events || []).length > 0 && (
                      <details className="mt-3 text-sm">
                        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                          Observed event history
                        </summary>
                        <ol className="space-y-2">
                          {sale.events.map((event, index) => (
                            <li
                              key={`${event.observedAt}-${index}`}
                              className="text-xs text-muted-foreground"
                            >
                              {event.event.replace(/_/g, " ")} ·{" "}
                              {timestamp(event.observedAt)}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                    <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>
                        <dt>Order</dt>
                        <dd className="mt-1 break-all">{sale.transactionId}</dd>
                      </div>
                      <div>
                        <dt>Created</dt>
                        <dd className="mt-1">{timestamp(sale.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>Buyer account</dt>
                        <dd className="mt-1 break-all">{sale.buyerId}</dd>
                      </div>
                      <div>
                        <dt>Seller account</dt>
                        <dd className="mt-1 break-all">{sale.sellerId}</dd>
                      </div>
                      <div>
                        <dt>Completion evidence</dt>
                        <dd className="mt-1">
                          {sale.completedAt
                            ? timestamp(sale.completedAt)
                            : "Not recorded"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    className={control}
                    onClick={() =>
                      choose({
                        path: `${endpoint}/sales/${encodeURIComponent(sale.transactionId)}`,
                        action: sale.manualHold ? "clear" : "hold",
                        title: sale.manualHold
                          ? "Clear manual review hold"
                          : "Hold sale for review",
                        subject: `${sale.businessName} · ${sale.transactionId}`,
                      })
                    }
                  >
                    {sale.manualHold ? "Clear manual hold" : "Hold for review"}
                  </button>
                </div>
              </article>
            ))}
          </section>

          <section
            className="rounded-3xl border border-border bg-card p-5 sm:p-7"
            aria-labelledby="finalize-title"
          >
            <h2
              id="finalize-title"
              className="font-yrdly-display text-2xl font-bold"
            >
              Review the final standings
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The sales window closes automatically. Results can be saved only
              after the seven-day review period and all required investigations.
              A changed snapshot must be reviewed again. Winner announcement and
              prize payment remain separate actions.
            </p>
            <ol className="mt-5 space-y-2">
              {data.snapshot.entries.map((entry) => (
                <li
                  key={entry.businessId}
                  className="flex items-start justify-between gap-4 rounded-xl bg-muted p-3 text-sm"
                >
                  <span className="min-w-0 break-words">
                    #{entry.rank} {entry.name}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {entry.completedSales} sales
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              disabled={disabled || !data.canFinalize}
              onClick={() =>
                choose({
                  path: `${endpoint}/finalize`,
                  title: "Save reviewed final results",
                  subject: `Snapshot ${data.snapshot.id}`,
                  expectedSnapshotId: data.snapshot.id,
                  final: true,
                })
              }
              className={`${control} mt-5 bg-primary text-primary-foreground`}
            >
              {data.campaign.status === "finalized"
                ? "Final results saved"
                : "Save reviewed final results"}
            </button>
            {!data.canFinalize && data.campaign.status !== "finalized" && (
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                Finalization is unavailable while the campaign/review period is
                open or required cases remain unresolved.
              </p>
            )}
          </section>

          {userId && (
            <CampaignPrizeRecords
              key={userId}
              data={data}
              userId={userId}
              onSaved={refresh}
            />
          )}
          <section aria-labelledby="campaign-audit-title" className="space-y-3">
            <h2
              id="campaign-audit-title"
              className="font-yrdly-display text-2xl font-bold"
            >
              Audit history
            </h2>
            {data.audit.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No administrative decisions recorded.
              </p>
            )}
            {data.audit.map((event) => (
              <article
                key={event.id}
                className="rounded-xl border border-border p-4"
              >
                <p className="text-sm font-semibold">
                  {event.action.replace(/_/g, " ")}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                  {event.reason}
                </p>
                <p className="mt-2 break-all text-xs leading-6 text-muted-foreground">
                  {timestamp(event.createdAt)} · Actor{" "}
                  {event.actorId || "System"}
                  {event.subjectId ? ` · Subject ${event.subjectId}` : ""}
                </p>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
