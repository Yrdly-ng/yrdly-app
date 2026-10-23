"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CalendarDays, Plus, QrCode, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { getOrganizerEvents } from "@/lib/events/event-service";
import { getEventDateInfo } from "@/lib/events/event-presentation";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { Event } from "@/types/events";

type Filter = "Upcoming" | "Drafts" | "Past" | "Cancelled";
export default function MyEventsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("Upcoming");
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    if (!user) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    void getOrganizerEvents(user.id)
      .then((data) => {
        if (current) setEvents(data || []);
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [user?.id, reload]);
  const now = Date.now();
  const visible = events.filter((event) => {
    if (filter === "Cancelled") return event.status === "CANCELLED";
    if (filter === "Drafts")
      return ["DRAFT", "PENDING_REVIEW", "REJECTED"].includes(event.status);
    if (event.status === "COMPLETED") return filter === "Past";
    if (event.status !== "PUBLISHED") return false;
    return filter === "Upcoming"
      ? new Date(event.end_time || event.start_time).getTime() >= now
      : new Date(event.end_time || event.start_time).getTime() < now;
  });
  return (
    <main className="mx-auto max-w-5xl space-y-7 px-4 py-6 pb-28 font-yrdly-body sm:px-6 lg:py-10">
      <button
        type="button"
        aria-label="Back"
        onClick={() => router.back()}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-border"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            BRING PEOPLE TOGETHER
          </p>
          <h1 className="font-yrdly-display text-4xl font-bold">
            Your events.
          </h1>
          <p className="text-muted-foreground">
            From the first idea to the final guest. Manage it all here.
          </p>
        </div>
        <Link
          href="/events/create"
          className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Create event
        </Link>
      </header>
      <Link
        href="/events/team"
        className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold"
      >
        Assigned events →
      </Link>
      {!user ? (
        <p className="rounded-2xl border border-border bg-card p-6">
          Sign in to manage your events.
        </p>
      ) : (
        <>
          <div
            role="group"
            aria-label="Event status"
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {(["Upcoming", "Drafts", "Past", "Cancelled"] as const).map(
              (tab) => (
                <button
                  type="button"
                  key={tab}
                  onClick={() => setFilter(tab)}
                  aria-pressed={tab === filter}
                  className={`min-h-11 shrink-0 rounded-full border px-5 text-sm font-semibold ${tab === filter ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}
                >
                  {tab}
                </button>
              ),
            )}
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-border bg-card p-5"
            >
              Couldn’t load your events.
              <button
                type="button"
                onClick={() => setReload((value) => value + 1)}
                className="ml-3 min-h-11 font-bold text-primary"
              >
                Try again
              </button>
            </div>
          )}
          {loading ? (
            <p
              role="status"
              className="py-10 text-center text-muted-foreground"
            >
              Loading your events…
            </p>
          ) : visible.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {visible.map((event) => {
                const date = getEventDateInfo(event.start_time);
                return (
                  <article
                    key={event.id}
                    className="overflow-hidden rounded-[26px] border border-border bg-card"
                  >
                    <Link href={`/events/${event.id}`} className="block">
                      <div className="relative aspect-[16/9] bg-muted">
                        {event.cover_image_url ? (
                          <Image
                            src={event.cover_image_url}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 100vw, 50vw"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <CalendarDays className="h-10 w-10 text-primary/50" />
                          </div>
                        )}
                        <span className="absolute left-4 top-4 rounded-full bg-background/95 px-3 py-1 text-xs font-semibold">
                          {event.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="space-y-2 p-5">
                        <h2 className="font-yrdly-display text-2xl font-bold">
                          {event.title}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          {date
                            ? `${date.full} · ${date.time}`
                            : "Date to be announced"}
                        </p>
                        {event.location_address && (
                          <p className="truncate text-sm text-muted-foreground">
                            {event.location_address}
                          </p>
                        )}
                      </div>
                    </Link>
                    <div className="flex flex-wrap gap-2 border-t border-border p-4">
                      <Link
                        href={`/events/${event.id}/manage`}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
                      >
                        <Settings className="h-4 w-4" />
                        Manage event
                      </Link>
                      {event.status === "PUBLISHED" && (
                        <Link
                          href={`/events/${event.id}/scan`}
                          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold"
                        >
                          <QrCode className="h-4 w-4" />
                          Scan tickets
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            !error && (
              <div className="rounded-[26px] border border-dashed border-border px-6 py-16 text-center">
                <CalendarDays className="mx-auto mb-4 h-10 w-10 text-primary" />
                <h2 className="font-yrdly-display text-2xl font-bold">
                  No {filter.toLowerCase()} events yet.
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your events will appear here as their status changes.
                </p>
              </div>
            )
          )}
        </>
      )}
    </main>
  );
}
