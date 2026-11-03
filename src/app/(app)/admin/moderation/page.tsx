"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PrivateMediaImage } from "@/components/media/PrivateMedia";
import { supabase } from "@/lib/supabase/supabase";
import {
  ReportAction,
  ReportCase,
  ReportKind,
} from "@/lib/moderation/report-case";
import {
  ModerationAdminService,
  ModerationQueueItem,
} from "@/lib/moderation/moderation-admin";

async function request<T>(url: string, body?: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
const labels: Record<ReportAction, string> = {
  resolve: "Mark resolved",
  dismiss: "Dismiss report",
  reopen: "Reopen report",
  hide: "Hide content",
  restore: "Restore content",
  suspend: "Suspend account",
  ban: "Ban account",
  unsuspend: "Restore account access",
};
export default function ModerationPage() {
  const [kind, setKind] = useState<ReportKind | "auto">("general"),
    [status, setStatus] = useState("open"),
    [child, setChild] = useState(false),
    [page, setPage] = useState(1);
  const [cases, setCases] = useState<ReportCase[]>([]),
    [flags, setFlags] = useState<ModerationQueueItem[]>([]),
    [count, setCount] = useState(0),
    [selected, setSelected] = useState<ReportCase | null>(null),
    [reason, setReason] = useState(""),
    [action, setAction] = useState<ReportAction>("resolve");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [showMedia, setShowMedia] = useState(false),
    [flagMedia, setFlagMedia] = useState<string | null>(null);
  const listRequest = useRef(0),
    detailRequest = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++listRequest.current;
    setLoading(true);
    setError("");
    try {
      if (kind === "auto") {
        const result = await ModerationAdminService.getQueue("pending", page);
        if (requestId !== listRequest.current) return;
        setFlags(result.data);
        setCount(result.count);
      } else {
        const result = await request<{ data: ReportCase[]; count: number }>(
          `/api/admin/reports?kind=${kind}&status=${status}&page=${page}${child && kind === "general" ? "&category=Child%20safety" : ""}`,
        );
        if (requestId !== listRequest.current) return;
        setCases(result.data);
        setCount(result.count);
      }
    } catch (e) {
      if (requestId === listRequest.current)
        setError(e instanceof Error ? e.message : "Could not load reports.");
    } finally {
      if (requestId === listRequest.current) setLoading(false);
    }
  }, [kind, status, page, child]);
  useEffect(() => {
    void load();
    return () => {
      listRequest.current++;
      detailRequest.current++;
    };
  }, [load]);
  const open = async (report: ReportCase) => {
    const requestId = ++detailRequest.current;
    setBusy(true);
    setError("");
    try {
      const detail = await request<ReportCase>(
        `/api/admin/reports/${report.kind}/${report.id}`,
      );
      if (requestId !== detailRequest.current) return;
      setSelected(detail);
      setReason("");
      setShowMedia(false);
      setAction(report.status === "open" ? "resolve" : "reopen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open report.");
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!selected || reason.trim().length < 5 || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/admin/reports/${selected.kind}/${selected.id}`, {
        action,
        reason,
        expectedStatus: selected.status,
      });
      setSelected(
        await request<ReportCase>(
          `/api/admin/reports/${selected.kind}/${selected.id}`,
        ),
      );
      setReason("");
      setMessage(`${labels[action]}: action recorded.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };
  const moderate = async (id: string, decision: "approve" | "reject") => {
    if (
      !window.confirm(
        `${decision === "approve" ? "Publish" : "Keep hidden"} this content?`,
      )
    )
      return;
    setBusy(true);
    try {
      await ModerationAdminService.moderateContent(id, decision);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };
  const field = "w-full rounded-lg border border-current/20 bg-transparent p-3";
  const button =
    "rounded-lg border border-current/20 px-4 py-3 disabled:opacity-40";
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 text-[var(--yrdly-text-primary)] sm:p-6">
      <h1 className="text-3xl font-bold">Reports &amp; Safety</h1>
      <p>
        Review what happened, take action, and keep a record of your decision.
      </p>
      <nav className="flex flex-wrap gap-3">
        <Link className={button} href="/admin/disputes">
          Payment disputes
        </Link>
        <Link className={button} href="/community-review">
          Community reviews
        </Link>
      </nav>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          Report type
          <select
            className={field}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setPage(1);
              setSelected(null);
            }}
          >
            <option value="general">General &amp; safety reports</option>
            <option value="post">Reported posts</option>
            <option value="comment">Reported comments</option>
            <option value="auto">Flagged content</option>
          </select>
        </label>
        {kind !== "auto" && (
          <label>
            Status
            <select
              className={field}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="open">Needs review</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All reports</option>
            </select>
          </label>
        )}
        {kind === "general" && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={child}
              onChange={(e) => {
                setChild(e.target.checked);
                setPage(1);
              }}
            />
            Child safety only
          </label>
        )}
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-500 p-4">
          {error}{" "}
          <button className={button} onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {selected && (
        <section
          aria-label="Report details"
          className="space-y-4 rounded-2xl border border-current/20 p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-xl font-bold">{selected.subject}</h2>
            <button className={button} onClick={() => setSelected(null)}>
              Close details
            </button>
          </div>
          <p>
            {selected.category} ·{" "}
            {selected.status === "open" ? "Needs review" : selected.status} ·{" "}
            {new Date(selected.createdAt).toLocaleString()}
          </p>
          <p>
            <strong>Reported by:</strong>{" "}
            {selected.reporter?.name || "Account unavailable"}
          </p>
          <p>
            <strong>Reported account:</strong>{" "}
            {selected.reportedAccount?.name || "No linked account"}
            {selected.reportedAccount?.isBanned
              ? " · Banned"
              : selected.reportedAccount?.isSuspended
                ? " · Suspended"
                : ""}
          </p>
          <div>
            <h3 className="font-bold">Reporter’s explanation</h3>
            <p className="whitespace-pre-wrap break-words">
              {selected.description || "No explanation supplied."}
            </p>
          </div>
          <div>
            <h3 className="font-bold">
              Reported content {selected.content?.hidden ? "· Hidden" : ""}
            </h3>
            {selected.sensitive && (
              <p className="text-sm">
                Sensitive media is not displayed in this review. Do not download
                or share suspected illegal material.
              </p>
            )}
            <p className="whitespace-pre-wrap break-words">
              {selected.content?.text ||
                "Content is unavailable or was not linked to this report."}
            </p>
          </div>
          {!selected.sensitive && selected.media.length > 0 && (
            <div>
              <button
                className={button}
                onClick={() => setShowMedia((v) => !v)}
              >
                {showMedia
                  ? "Hide attachments"
                  : `View attachments (${selected.media.length})`}
              </button>
              {showMedia && (
                <div className="flex flex-wrap gap-3">
                  {selected.media.map((src, i) => (
                    <PrivateMediaImage
                      key={src}
                      src={src}
                      alt={`Report attachment ${i + 1}`}
                      width={240}
                      height={180}
                      className="max-w-full rounded-lg object-contain"
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          <details>
            <summary>Reference details</summary>
            <p className="break-all">Report: {selected.id}</p>
            {selected.content && (
              <p className="break-all">Content: {selected.content.id}</p>
            )}
          </details>
          <h3 className="font-bold">Action history</h3>
          {selected.history.length ? (
            selected.history.map((h) => (
              <div key={h.id} className="border-l-2 pl-3">
                <p>
                  {h.action} · {h.actorName} ·{" "}
                  {new Date(h.createdAt).toLocaleString()}
                </p>
                <p className="break-words">{h.reason}</p>
              </div>
            ))
          ) : (
            <p>No recorded actions yet.</p>
          )}
          <label className="block">
            Choose an action
            <select
              className={field}
              value={action}
              onChange={(e) => setAction(e.target.value as ReportAction)}
            >
              {(Object.keys(labels) as ReportAction[])
                .filter((a) =>
                  a === "reopen"
                    ? selected.status !== "open"
                    : ["resolve", "dismiss"].includes(a)
                      ? selected.status === "open"
                      : ["hide", "restore"].includes(a)
                        ? !!selected.content
                        : !!selected.reportedAccount,
                )
                .map((a) => (
                  <option key={a} value={a}>
                    {labels[a]}
                  </option>
                ))}
            </select>
          </label>
          <p className="text-sm">
            Hiding content or restricting an account does not close this report.
            Resolve it when the review is complete. Restoring content makes it
            visible again.
          </p>
          <label className="block">
            Reason for your decision
            <textarea
              className={field}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain what you reviewed and why you are taking this action."
            />
          </label>
          <button
            className={button}
            disabled={busy || reason.trim().length < 5}
            onClick={() => {
              if (
                window.confirm(
                  `${labels[action]} for ${selected.reportedAccount?.name || selected.subject}?\n\nReason: ${reason.trim()}\n\nThis decision and your reason will be recorded.`,
                )
              )
                void apply();
            }}
          >
            {busy ? "Saving…" : "Confirm action"}
          </button>
        </section>
      )}
      {loading ? (
        <p role="status">Loading reports…</p>
      ) : kind === "auto" ? (
        <div className="space-y-3">
          {!flags.length && <p>No content waiting for review.</p>}
          {flags.map((f) => (
            <article key={f.id} className="space-y-3 rounded-xl border p-4">
              <h2 className="font-bold">Content awaiting review</h2>
              <p>{f.reason}</p>
              <p className="whitespace-pre-wrap">
                {f.text_content || "No text supplied."}
              </p>
              {f.image_urls?.length ? (
                <div>
                  <button
                    className={button}
                    onClick={() =>
                      setFlagMedia(flagMedia === f.id ? null : f.id)
                    }
                  >
                    View flagged images ({f.image_urls.length})
                  </button>
                  {flagMedia === f.id && (
                    <div className="flex flex-wrap gap-2">
                      {f.image_urls.map((src, i) => (
                        <PrivateMediaImage
                          key={src}
                          src={src}
                          alt={`Flagged attachment ${i + 1}`}
                          width={200}
                          height={160}
                          className="max-w-full object-contain"
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              <div className="flex gap-2">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void moderate(f.id, "approve")}
                >
                  Approve content
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void moderate(f.id, "reject")}
                >
                  Keep hidden
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {!cases.length && <p>No reports match these filters.</p>}
          {cases.map((r) => (
            <article
              key={r.id}
              className="space-y-2 rounded-xl border border-current/20 p-4"
            >
              <h2 className="font-bold">{r.subject}</h2>
              <p>
                {r.category} · {r.status === "open" ? "Needs review" : r.status}
              </p>
              <p>
                {r.reportedAccount?.name || "No linked account"} ·{" "}
                {new Date(r.createdAt).toLocaleString()}
              </p>
              <p className="line-clamp-3 break-words">{r.description}</p>
              <button
                className={button}
                disabled={busy}
                onClick={() => void open(r)}
              >
                Review report
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <button
          className={button}
          disabled={loading || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} · {count} reports
        </span>
        <button
          className={button}
          disabled={loading || page * 20 >= count}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </main>
  );
}
