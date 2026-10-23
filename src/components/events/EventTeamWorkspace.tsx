"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, QrCode, RefreshCw, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import {
  eventTeamEndpoint,
  eventTeamRequest,
  eventTeamRoleLabel,
  type EventAssignment,
  type EventTeamAction,
  type EventTeamData,
  type EventTeamRole,
} from "@/lib/events/event-team";

const actionClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
const cardClass = "rounded-3xl border border-border bg-card p-5 sm:p-6";
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
};
export function EventTeamWorkspace({ eventId }: { eventId?: string }) {
  const { user } = useAuth();
  return (
    <EventTeamWorkspaceContent
      key={`${user?.id || "signed-out"}:${eventId || "assignments"}`}
      eventId={eventId}
    />
  );
}
function EventTeamWorkspaceContent({ eventId }: { eventId?: string }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [assignments, setAssignments] = useState<EventAssignment[]>([]);
  const [data, setData] = useState<EventTeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<EventTeamRole>("checkin");
  const generation = useRef(0);
  const readInFlight = useRef(0);
  const mutationInFlight = useRef(false);
  const mounted = useRef(true);
  const clear = useCallback(() => {
    setData(null);
    setAssignments([]);
  }, []);
  const load = useCallback(
    async (force = false) => {
      if (mutationInFlight.current || (readInFlight.current && !force)) return;
      const request = ++generation.current;
      readInFlight.current = request;
      if (!userId) {
        clear();
        setLoading(false);
        readInFlight.current = 0;
        return;
      }
      setError("");
      try {
        if (eventId) {
          const result = await eventTeamRequest<EventTeamData>(
            eventTeamEndpoint(eventId),
          );
          if (request === generation.current) setData(result);
        } else {
          const result = await eventTeamRequest<{
            assignments: EventAssignment[];
          }>(eventTeamEndpoint());
          if (request === generation.current)
            setAssignments(result.assignments);
        }
      } catch (failure) {
        if (request !== generation.current) return;
        const problem = failure as Error & { status?: number };
        if (
          problem.status === 401 ||
          problem.status === 403 ||
          problem.status === 404 ||
          /session.*expired|sign in/i.test(problem.message)
        )
          clear();
        setError(problem.message || "Could not load your event team.");
      } finally {
        if (readInFlight.current === request) readInFlight.current = 0;
        if (request === generation.current) setLoading(false);
      }
    },
    [userId, eventId, clear],
  );
  useEffect(() => {
    mounted.current = true;
    clear();
    setLoading(true);
    void load(true);
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [load, clear]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  useEffect(() => {
    if (!eventId || !userId) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      if (timer) clearInterval(timer);
      timer =
        document.visibilityState === "visible"
          ? setInterval(() => {
              void load();
            }, 20_000)
          : undefined;
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [eventId, userId, load]);
  const mutate = async (id: string, body: EventTeamAction) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await eventTeamRequest(eventTeamEndpoint(id), body);
      if (!mounted.current) return;
      if (body.action === "invite") setEmail("");
      setNotice(
        body.action === "invite"
          ? "Invitation sent. They can accept in Assigned events."
          : "Your event team has been updated.",
      );
      mutationInFlight.current = false;
      await load(true);
    } catch (failure) {
      if (!mounted.current) return;
      const problem = failure as Error & { status?: number };
      if (
        problem.status === 401 ||
        problem.status === 403 ||
        problem.status === 404 ||
        /session.*expired|sign in/i.test(problem.message)
      )
        clear();
      setError(problem.message || "Could not update your event team.");
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const canManage = data?.role === "organizer" || data?.role === "manager";
  const canScan = data?.event.status.toUpperCase() === "PUBLISHED";
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 pb-28 font-yrdly-body sm:px-6 lg:py-10">
      <Link href={eventId ? "/events/team" : "/events"} className={actionClass}>
        <ArrowLeft className="h-4 w-4" />
        {eventId ? "Assigned events" : "Events"}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            THE DOOR TEAM
          </p>
          <h1 className="font-yrdly-display text-4xl font-bold tracking-tight sm:text-5xl">
            {eventId ? "Welcome them in." : "Your place on the team."}
          </h1>
          <p className="leading-relaxed text-muted-foreground">
            {data?.event.title ||
              (eventId
                ? "Team access, attendance and check-ins, together."
                : "Accept invitations and check in guests using your own account.")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          disabled={loading || busy}
          className={actionClass}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>
      <p className="text-sm text-muted-foreground">
        Online check-in keeps every entrance in sync. Refresh for the latest
        attendance.
      </p>
      {!user && (
        <section className={cardClass}>
          <p>Sign in to see your invitations and event assignments.</p>
          <Link href="/login" className={`${actionClass} mt-4`}>
            Sign in
          </Link>
        </section>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p>{error}</p>
          <button
            type="button"
            className={`${actionClass} mt-3`}
            disabled={busy}
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm"
        >
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="py-8 text-muted-foreground">
          Loading your event team…
        </p>
      )}
      {user && !loading && !eventId && (
        <section className="space-y-4" aria-label="Assigned events">
          {!assignments.length && !error && (
            <div className={`${cardClass} space-y-3`}>
              <Users className="h-7 w-7 text-primary" />
              <h2 className="font-yrdly-display text-2xl font-bold">
                Your next event starts here.
              </h2>
              <p className="text-muted-foreground">
                Ask an organiser to invite the email on your YRDLY account.
                Invitations will appear here.
              </p>
            </div>
          )}
          {assignments.map((item) => (
            <article key={item.id} className={`${cardClass} space-y-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">
                    {eventTeamRoleLabel(item.role)} · {item.status}
                  </p>
                  <h2 className="font-yrdly-display text-2xl font-bold">
                    {item.event?.title || "Event"}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {dateLabel(item.event?.start_time)}
                  </p>
                </div>
                <span className="rounded-full border border-border px-3 py-1 text-xs">
                  {item.event?.status}
                </span>
              </div>
              {item.status === "pending" && item.expires_at && (
                <p className="text-xs text-muted-foreground">
                  Invitation expires {dateLabel(item.expires_at)}
                </p>
              )}
              {item.status === "pending" &&
              (!item.expires_at || Date.parse(item.expires_at) > Date.now()) ? (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    className={`${actionClass} border-primary bg-primary text-primary-foreground`}
                    onClick={() =>
                      void mutate(item.event_id, {
                        action: "accept",
                        member_id: item.id,
                      })
                    }
                  >
                    Accept invitation
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={actionClass}
                    onClick={() =>
                      void mutate(item.event_id, {
                        action: "decline",
                        member_id: item.id,
                      })
                    }
                  >
                    Decline
                  </button>
                </div>
              ) : item.status === "active" ? (
                <Link
                  className={actionClass}
                  href={`/events/${item.event_id}/team`}
                >
                  Open event desk →
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This assignment no longer grants event access.
                </p>
              )}
            </article>
          ))}
        </section>
      )}
      {user && !loading && data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm font-semibold">
              Your access: {eventTeamRoleLabel(data.role)}
            </p>
            {canScan ? (
              <Link
                href={`/events/${eventId}/scan`}
                className={`${actionClass} border-primary bg-primary text-primary-foreground`}
              >
                <QrCode className="h-5 w-5" />
                Scan tickets
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">
                Check-in is unavailable while this event is{" "}
                {data.event.status.toLowerCase().replaceAll("_", " ")}.
              </p>
            )}
          </div>
          <section aria-label="Attendance" className="grid grid-cols-3 gap-3">
            {[
              ["Expected", data.summary.total],
              ["Checked in", data.summary.checked_in],
              ["Remaining", data.summary.remaining],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 font-yrdly-display text-3xl font-bold">
                  {value}
                </p>
              </div>
            ))}
          </section>
          {canManage && (
            <section className={`${cardClass} space-y-5`}>
              <div>
                <h2 className="font-yrdly-display text-2xl font-bold">
                  Build your door team.
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Invite someone with an existing YRDLY account. Check-in staff
                  can scan and view attendance. Managers can also invite and
                  manage check-in staff. Financial controls stay with the
                  organiser.
                </p>
              </div>
              <form
                className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(eventId!, {
                    action: "invite",
                    email: email.trim(),
                    role: data.role === "organizer" ? role : "checkin",
                  });
                }}
              >
                <label className="min-w-0 flex-1 text-sm font-semibold">
                  YRDLY account email
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 font-normal"
                    placeholder="teammate@example.com"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Role
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as EventTeamRole)}
                    className="mt-2 block min-h-12 rounded-xl border border-border bg-background px-3 font-normal"
                  >
                    <option value="checkin">Check-in staff</option>
                    {data.role === "organizer" && (
                      <option value="manager">Event manager</option>
                    )}
                  </select>
                </label>
                <button
                  disabled={busy}
                  className={`${actionClass} min-h-12 border-primary bg-primary text-primary-foreground`}
                >
                  {busy ? "Updating…" : "Send invitation"}
                </button>
              </form>
              <div className="divide-y divide-border">
                {!data.members.length && (
                  <p className="py-3 text-sm text-muted-foreground">
                    No teammates yet. Invite your first person above.
                  </p>
                )}
                {data.members.map((member) => {
                  const editable =
                    data.role === "organizer" || member.role === "checkin";
                  return (
                    <div
                      key={member.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-4"
                    >
                      <div>
                        <p className="font-semibold">
                          {member.user?.name ||
                            member.user?.email ||
                            member.name ||
                            "YRDLY member"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {eventTeamRoleLabel(member.role)} · {member.status}
                        </p>
                        {member.status === "pending" && member.expires_at && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Invitation expires {dateLabel(member.expires_at)}
                          </p>
                        )}
                      </div>
                      {editable &&
                        ["active", "pending"].includes(member.status) && (
                          <div className="flex flex-wrap gap-2">
                            {data.role === "organizer" && (
                              <button
                                type="button"
                                disabled={busy}
                                className={actionClass}
                                onClick={() => {
                                  const next =
                                    member.role === "manager"
                                      ? "checkin"
                                      : "manager";
                                  if (
                                    window.confirm(
                                      `Change ${member.user?.name || "this member"} to ${eventTeamRoleLabel(next)}?`,
                                    )
                                  )
                                    void mutate(eventId!, {
                                      action: "update_role",
                                      member_id: member.id,
                                      role: next,
                                    });
                                }}
                              >
                                Make{" "}
                                {member.role === "manager"
                                  ? "check-in staff"
                                  : "manager"}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busy}
                              className={`${actionClass} text-destructive`}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Revoke this person's event access? They will no longer be able to scan tickets.",
                                  )
                                )
                                  void mutate(eventId!, {
                                    action: "revoke",
                                    member_id: member.id,
                                  });
                              }}
                            >
                              Revoke
                            </button>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {!!data.guests?.length && (
            <section className={`${cardClass} space-y-4`}>
              <h2 className="font-yrdly-display text-2xl font-bold">
                Guest list
              </h2>
              <p className="text-sm text-muted-foreground">
                Showing up to 200 guests. Attendance totals cover the whole
                event.
              </p>
              <ul className="divide-y divide-border">
                {data.guests.map((guest) => (
                  <li key={guest.id} className="py-3">
                    <p className="font-semibold">
                      {guest.attendee_name || guest.user_name || "Guest"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {guest.status}
                      {guest.tier_name || guest.tier?.name
                        ? ` · ${guest.tier_name || guest.tier?.name}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className={`${cardClass} space-y-4`}>
            <h2 className="font-yrdly-display text-2xl font-bold">
              At the entrance.
            </h2>
            <p className="text-sm text-muted-foreground">
              The latest 100 successful admissions. Each ticket can be checked
              in once.
            </p>
            {!data.history.length ? (
              <p className="py-4 text-sm text-muted-foreground">
                No guests checked in yet.
              </p>
            ) : (
              <ol className="divide-y divide-border">
                {data.history.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap justify-between gap-2 py-4"
                  >
                    <div>
                      <p className="font-semibold">
                        {item.attendee_name || "Guest"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        By {item.scanner_name || "Event team"}
                      </p>
                    </div>
                    <time
                      dateTime={item.scanned_at}
                      className="text-sm text-muted-foreground"
                    >
                      {dateLabel(item.scanned_at)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </main>
  );
}
