"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/supabase";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-supabase-auth";

type Account = {
  user_id: string;
  slot: number;
  status: string;
  persona: { name: string; bio: string; writing_style: string };
};
type Draft = {
  id: string;
  account_id: string;
  action: string;
  text?: string;
  status: string;
  target_post_id?: string;
};
type Job = {
  id: string;
  status: string;
  scheduled_at: string;
  last_error?: string;
};
type Audit = {
  id: number;
  operation: string;
  outcome: string;
  created_at: string;
  detail?: unknown;
};
type Configuration = {
  enabled: boolean;
  posting_enabled: boolean;
  commenting_enabled: boolean;
  liking_enabled: boolean;
  client_disclosure_ready: boolean;
  daily_posts: number;
  daily_comments: number;
  daily_likes: number;
  start_hour: number;
  end_hour: number;
};
type Snapshot = {
  config: Configuration;
  accounts: Account[];
  drafts: Draft[];
  jobs: Job[];
  audit: Audit[];
};
const field =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

export default function VirtualAccountsAdminPage() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [draftAction, setDraftAction] = useState("post");

  const load = useCallback(async () => {
    const { data, error: failure } = await supabase.rpc(
      "managed_virtual_admin",
      { p_operation: "status" },
    );
    if (failure) throw new Error(failure.message);
    setSnapshot(data);
    setConfiguration(data.config);
  }, []);
  useEffect(() => {
    if (user) void load().catch((failure: Error) => setError(failure.message));
  }, [load, user]);

  async function command(
    operation: string,
    payload: Record<string, unknown> = {},
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: failure } = await supabase.rpc("managed_virtual_admin", {
        p_operation: operation,
        p_payload: payload,
      });
      if (failure) throw new Error(failure.message);
      await load();
      setNotice(
        "Saved. Activity remains subject to the schedule and account limits.",
      );
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save changes.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setStopping(true);
    setError("");
    try {
      const { error: failure } = await supabase.rpc("managed_virtual_admin", {
        p_operation: "stop",
      });
      if (failure) throw new Error(failure.message);
      setNotice(
        "Stopped. No further managed activity can publish until explicitly resumed.",
      );
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Stop could not be confirmed. Retry immediately.",
      );
    } finally {
      setStopping(false);
    }
  }
  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const saved = await command("draft", {
      account_id: values.get("account_id"),
      action: draftAction,
      text: values.get("text") || "",
      topic: values.get("topic") || "",
      ...(values.get("target_post_id")
        ? { target_post_id: values.get("target_post_id") }
        : {}),
    });
    if (saved) form.reset();
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-border pb-6">
        <div className="max-w-xl space-y-2">
          <Link
            href="/admin/moderation"
            className="text-sm text-muted-foreground underline"
          >
            Moderation
          </Link>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            YRDLY / Managed activity
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Virtual accounts
          </h1>
          <p className="text-sm text-muted-foreground">
            Fictional, clearly identified accounts. Review content before
            scheduling it; organic engagement remains separate.
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => void stop()}
          disabled={stopping}
        >
          {stopping ? "Stopping…" : "Emergency stop"}
        </Button>
      </header>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg bg-muted p-4 text-sm">
          {notice}
        </p>
      ) : null}
      {!snapshot || !configuration ? (
        <p className="text-muted-foreground">
          {error
            ? "Controls are unavailable. No activity has been enabled from this screen."
            : "Loading managed accounts…"}
        </p>
      ) : (
        <>
          <section
            aria-label="Fleet status"
            className="grid gap-4 sm:grid-cols-3"
          >
            {[
              ["System", configuration.enabled ? "Enabled" : "Stopped"],
              ["Provisioned accounts", `${snapshot.accounts.length} / 50`],
              [
                "Active accounts",
                String(
                  snapshot.accounts.filter((a) => a.status === "active").length,
                ),
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </section>
          <form
            className="space-y-5 rounded-xl border border-border p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void command("configure", configuration);
            }}
          >
            <div>
              <h2 className="text-xl font-semibold">Schedule & limits</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Hours use Lagos time. Limits apply to the entire fleet;
                individual account limits also apply.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["daily_posts", "Posts per day"],
                  ["daily_comments", "Comments per day"],
                  ["daily_likes", "Virtual likes per day"],
                  ["start_hour", "Start hour (0–23)"],
                  ["end_hour", "End hour (1–24)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="space-y-1 text-sm">
                  <span>{label}</span>
                  <input
                    className={field}
                    type="number"
                    min={0}
                    max={
                      key === "start_hour"
                        ? 23
                        : key === "end_hour"
                          ? 24
                          : key === "daily_posts"
                            ? 50
                            : key === "daily_comments"
                              ? 100
                              : 250
                    }
                    required
                    value={configuration[key]}
                    onChange={(event) =>
                      setConfiguration({
                        ...configuration,
                        [key]: Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-5">
              {(
                [
                  ["posting_enabled", "Posts"],
                  ["commenting_enabled", "Comments"],
                  ["liking_enabled", "Virtual likes"],
                  [
                    "client_disclosure_ready",
                    "Web and mobile disclosure verified",
                  ],
                  ["enabled", "Enable scheduled activity"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={configuration[key]}
                    onChange={(event) =>
                      setConfiguration({
                        ...configuration,
                        [key]: event.target.checked,
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <Button disabled={busy || stopping} type="submit">
              Save configuration
            </Button>
          </form>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Accounts</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {snapshot.accounts.map((account) => (
                <article
                  className="rounded-xl border border-border p-4"
                  key={account.user_id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {account.slot}. {account.persona.name}
                      </h3>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {account.status}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || account.status === "retired"}
                      onClick={() =>
                        void command("account", {
                          user_id: account.user_id,
                          status:
                            account.status === "active" ? "paused" : "active",
                        })
                      }
                    >
                      {account.status === "active" ? "Pause" : "Activate"}
                    </Button>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {account.persona.bio}
                  </p>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer">Writing style</summary>
                    <p className="mt-2">{account.persona.writing_style}</p>
                  </details>
                </article>
              ))}
            </div>
            {!snapshot.accounts.length ? (
              <p className="text-sm text-muted-foreground">
                No managed accounts have been provisioned.
              </p>
            ) : null}
          </section>
          <form
            onSubmit={(event) => void createDraft(event)}
            className="space-y-4 rounded-xl border border-border p-5"
          >
            <h2 className="text-xl font-semibold">Prepare a draft</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                Account
                <select className={field} name="account_id" required>
                  <option value="">Choose account</option>
                  {snapshot.accounts.map((a) => (
                    <option value={a.user_id} key={a.user_id}>
                      {a.persona.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                Action
                <select
                  className={field}
                  value={draftAction}
                  onChange={(event) => setDraftAction(event.target.value)}
                >
                  <option value="post">Home-feed post</option>
                  <option value="comment">
                    Comment on another virtual account’s post
                  </option>
                  <option value="like">Virtual like</option>
                </select>
              </label>
            </div>
            {draftAction !== "post" ? (
              <label className="block space-y-1 text-sm">
                Target post ID
                <input className={field} name="target_post_id" required />
              </label>
            ) : null}
            {draftAction !== "like" ? (
              <>
                <label className="block space-y-1 text-sm">
                  Topic
                  <input
                    className={field}
                    name="topic"
                    maxLength={80}
                    required
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  Draft text
                  <textarea
                    className={field}
                    name="text"
                    rows={4}
                    maxLength={2000}
                    required
                  />
                </label>
              </>
            ) : null}
            <Button disabled={busy || !snapshot.accounts.length} type="submit">
              Save for review
            </Button>
          </form>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Review & schedule</h2>
            <label className="block max-w-sm space-y-1 text-sm">
              Publication time (your device’s timezone)
              <input
                type="datetime-local"
                className={field}
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>
            {snapshot.drafts.map((draft) => (
              <article
                key={draft.id}
                className="space-y-3 rounded-xl border border-border p-4"
              >
                <p className="text-sm font-semibold">
                  {snapshot.accounts.find((a) => a.user_id === draft.account_id)
                    ?.persona.name || "Managed account"}{" "}
                  · {draft.action} · {draft.status}
                </p>
                {draft.text ? (
                  <p className="whitespace-pre-wrap text-sm">{draft.text}</p>
                ) : null}
                {draft.target_post_id ? (
                  <p className="break-all text-xs text-muted-foreground">
                    Target: {draft.target_post_id}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {draft.status === "pending" ? (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void command("review", {
                            draft_id: draft.id,
                            approved: true,
                            reason:
                              "Reviewed for fictional disclosure, originality and content safety",
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void command("review", {
                            draft_id: draft.id,
                            approved: false,
                            reason: "Rejected during editorial review",
                          })
                        }
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {draft.status === "approved" ? (
                    <Button
                      size="sm"
                      disabled={busy || !scheduledAt}
                      onClick={() => {
                        const date = new Date(scheduledAt);
                        if (!Number.isFinite(date.getTime())) {
                          setError("Choose a valid publication time.");
                          return;
                        }
                        void command("schedule", {
                          draft_id: draft.id,
                          scheduled_at: date.toISOString(),
                          idempotency_key: `draft:${draft.id}`,
                        });
                      }}
                    >
                      Schedule approved draft
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
            {!snapshot.drafts.length ? (
              <p className="text-sm text-muted-foreground">
                No drafts awaiting review.
              </p>
            ) : null}
          </section>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Recent jobs</h2>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void load().catch((failure: Error) =>
                    setError(failure.message),
                  )
                }
              >
                Refresh
              </Button>
            </div>
            {snapshot.jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-lg border border-border p-3 text-sm"
              >
                <span className="font-medium">{job.status}</span> ·{" "}
                {new Date(job.scheduled_at).toLocaleString()}
                {job.last_error ? (
                  <p className="mt-1 text-destructive">{job.last_error}</p>
                ) : null}
              </div>
            ))}
          </section>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Audit trail</h2>
            <p className="text-sm text-muted-foreground">
              Recent administration and execution decisions.
            </p>
            {snapshot.audit.map((entry) => (
              <details
                key={entry.id}
                className="rounded-lg border border-border p-3 text-sm"
              >
                <summary className="cursor-pointer">
                  {entry.operation} · {entry.outcome} ·{" "}
                  {new Date(entry.created_at).toLocaleString()}
                </summary>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(entry.detail, null, 2)}
                </pre>
              </details>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
