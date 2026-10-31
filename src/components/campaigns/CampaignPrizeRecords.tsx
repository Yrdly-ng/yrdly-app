"use client";

import { useState } from "react";
import type { CampaignAdminResponse } from "@/lib/campaigns/types";
import { campaignRequest } from "./CampaignScreen";

const money = (amountKobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    amountKobo / 100,
  );

export function CampaignPrizeRecords({
  data,
  userId,
  onSaved,
}: {
  data: CampaignAdminResponse;
  userId: string;
  onSaved: () => Promise<void>;
}) {
  const [businessId, setBusinessId] = useState("");
  const [kind, setKind] = useState<"verification" | "payment">("verification");
  const [status, setStatus] = useState("verified");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const allocations = data.snapshot.prizeAllocations || [];
  const selected = allocations.find((item) => item.businessId === businessId);
  const locked =
    data.campaign.status !== "finalized" ||
    data.campaign.integrityReviewRequired;
  const save = async () => {
    if (
      locked ||
      !selected ||
      !confirmed ||
      reason.trim().length < 10 ||
      saving ||
      (kind === "payment" && !reference.trim())
    )
      return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await campaignRequest(
        `/api/admin/campaigns/small-businesses/prizes/${encodeURIComponent(businessId)}`,
        userId,
        undefined,
        {
          kind,
          status: kind === "payment" ? "recorded" : status,
          reason: reason.trim(),
          ...(kind === "payment"
            ? { amountKobo: selected.amountKobo, reference: reference.trim() }
            : {}),
        },
      );
      setMessage("Record saved. No transfer was initiated.");
      setReason("");
      setReference("");
      setConfirmed(false);
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this record.",
      );
    } finally {
      setSaving(false);
    }
  };
  const field =
    "mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-3 text-base disabled:opacity-60";
  return (
    <section
      className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-7"
      aria-labelledby="campaign-prizes-title"
    >
      <div>
        <h2
          id="campaign-prizes-title"
          className="font-yrdly-display text-2xl font-bold"
        >
          Prize allocation & records
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {data.snapshot.provisional
            ? "Proposed allocations from the current standings."
            : "Allocations from the reviewed final snapshot."}{" "}
          Shares use integer kobo. A one-kobo remainder goes in business-ID
          order, without changing rank. The total is exactly ₦500,000 whenever
          there is a qualifying first-place business.
        </p>
      </div>
      {allocations.length ? (
        <ul className="space-y-2">
          {allocations.map((item) => (
            <li
              key={item.businessId}
              className="flex flex-wrap justify-between gap-2 rounded-xl bg-muted p-3 text-sm"
            >
              <span className="break-words">
                {data.snapshot.entries.find(
                  (entry) => entry.businessId === item.businessId,
                )?.name || item.businessId}
              </span>
              <strong>{money(item.amountKobo)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No positive qualifying first-place score; no prize allocation is
          generated.
        </p>
      )}
      {locked ? (
        <p className="rounded-xl bg-muted p-4 text-sm">
          Winner verification and payment records open after reviewed final
          results are saved and any integrity review is resolved.
        </p>
      ) : (
        allocations.length > 0 && (
          <fieldset disabled={saving} className="space-y-4">
            <legend className="text-sm font-semibold">
              Record an authorized verification or an already completed prize
              payment
            </legend>
            <p className="text-sm leading-6 text-muted-foreground">
              Obtain separate authorization before winner or prize actions. This
              form records evidence and never sends money.
            </p>
            <label className="block text-sm font-semibold">
              Winning business
              <select
                className={field}
                value={businessId}
                onChange={(event) => {
                  setBusinessId(event.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">Choose a verified first-place business</option>
                {allocations.map((item) => (
                  <option key={item.businessId} value={item.businessId}>
                    {data.snapshot.entries.find(
                      (entry) => entry.businessId === item.businessId,
                    )?.name || item.businessId}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Record type
              <select
                className={field}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as "verification" | "payment");
                  setConfirmed(false);
                }}
              >
                <option value="verification">Winner verification</option>
                <option value="payment">Completed prize payment</option>
              </select>
            </label>
            {kind === "verification" ? (
              <label className="block text-sm font-semibold">
                Verification result
                <select
                  className={field}
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="verified">Verified</option>
                  <option value="needs_review">Needs review</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
            ) : (
              <>
                <p className="text-sm">
                  Required allocation:{" "}
                  <strong>
                    {selected
                      ? money(selected.amountKobo)
                      : "Choose a business"}
                  </strong>
                  . Winner verification is required before a payment record.
                </p>
                <label className="block text-sm font-semibold">
                  Payment reference
                  <input
                    className={field}
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    maxLength={200}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
            <label className="block text-sm font-semibold">
              Reason and evidence
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={10}
                maxLength={1000}
                rows={3}
                className={`${field} py-3`}
              />
            </label>
            <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I have separate authorization for this action and have
                independently checked the evidence. Payment records refer to an
                actual completed payment.
              </span>
            </label>
            <button
              type="button"
              disabled={
                !selected ||
                !confirmed ||
                saving ||
                reason.trim().length < 10 ||
                (kind === "payment" && !reference.trim())
              }
              onClick={() => void save()}
              className="min-h-12 rounded-xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving record…" : "Save evidence record"}
            </button>
          </fieldset>
        )
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <div className="space-y-2">
        {(data.prizeRecords || []).map((record) => (
          <article
            key={record.id}
            className="rounded-xl border border-border p-4 text-sm"
          >
            <p className="font-semibold">
              {record.kind} · {record.status}
              {record.amountKobo ? ` · ${money(record.amountKobo)}` : ""}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words">
              {record.reason}
            </p>
            <p className="mt-2 break-all text-xs text-muted-foreground">
              Business {record.businessId} · {record.createdAt}
              {record.reference ? ` · Reference ${record.reference}` : ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
