"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Plus,
  Search,
  SlidersHorizontal,
  Ticket,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useLocation } from "@/contexts/LocationContext";
import { getPublishedEvents } from "@/lib/events/event-service";
import {
  getEventPriceLabel,
  matchesEventDay,
} from "@/lib/events/event-presentation";
import type { Event } from "@/types/events";
import { EventCard } from "./EventCard";
import { EventCreatorOnboarding } from "./EventCreatorOnboarding";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatPrice } from "@/lib/shared/utils";

type Filter = "All" | "Today" | "This weekend" | "Free";
export function EventsScreen({ className }: { className?: string }) {
  const router = useRouter();
  const { profile } = useAuth();
  const { activeFilter } = useLocation();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [paymentError, setPaymentError] = useState<{
    message: string;
    reference?: string;
  } | null>(null);
  const state = activeFilter?.state,
    lga = activeFilter?.lga,
    ward = activeFilter?.ward;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (!code) return;
    const messages: Record<string, string> = {
      sold_out_payluk_refund_required:
        "The ticket tier sold out after payment. Contact support with the payment reference below to resolve the Payluk escrow.",
      payment_failed:
        "Your payment could not be confirmed. Please check your payment status before trying again.",
      verification_failed:
        "We could not verify the ticket payment. Contact support if you were charged.",
      payment_cancelled: "Payment was cancelled.",
    };
    setPaymentError({
      message: messages[code] || "Ticket checkout could not be completed.",
      reference: params.get("tx_ref") || undefined,
    });
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    void getPublishedEvents({
      state: state || undefined,
      lga: lga || undefined,
      ward: ward || undefined,
    })
      .then((data) => {
        if (current) setEvents(data);
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
  }, [state, lga, ward, reload]);
  const visible = useMemo(
    () =>
      events.filter((event) => {
        if (
          query.trim() &&
          ![event.title, event.category, event.location_address]
            .join(" ")
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        )
          return false;
        if (filter === "Free")
          return getEventPriceLabel(event, formatPrice) === "Free entry";
        return filter === "All" || matchesEventDay(event.start_time, filter);
      }),
    [events, query, filter],
  );
  const create = () =>
    profile?.phone_verified
      ? setOnboardingOpen(true)
      : router.push("/verify-phone");
  return (
    <div
      className={cn(
        "mx-auto min-h-[70vh] max-w-7xl space-y-7 px-4 py-6 pb-28 font-yrdly-body sm:px-6 lg:py-10",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-xl space-y-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            OUT THERE, TOGETHER
          </p>
          <h1 className="font-yrdly-display text-4xl font-bold tracking-tight sm:text-5xl">
            Make a plan.
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            Good company. New experiences. Find your next reason to head out.
          </p>
        </div>
        <button
          type="button"
          onClick={create}
          className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-5 w-5" />
          Create event
        </button>
      </header>
      <nav aria-label="Your events" className="flex flex-wrap gap-3">
        <Link
          href="/my-tickets"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:border-primary"
        >
          <Ticket className="h-4 w-4 text-primary" />
          My tickets
        </Link>
        <Link
          href="/my-events"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:border-primary"
        >
          <CalendarDays className="h-4 w-4 text-primary" />
          Hosting
        </Link>
      </nav>
      {paymentError && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
        >
          <p>{paymentError.message}</p>
          {paymentError.reference && (
            <p className="mt-2 break-all font-mono text-xs">
              Payment reference: {paymentError.reference}
            </p>
          )}
        </div>
      )}
      <div
        role="search"
        className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4"
      >
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          type="search"
          aria-label="Search events"
          placeholder="Search events, places or interests"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear event search"
            onClick={() => setQuery("")}
            className="flex h-11 w-11 items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="group"
        aria-label="Filter events"
      >
        {(["All", "Today", "This weekend", "Free"] as const).map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={item === filter}
            onClick={() => setFilter(item)}
            className={cn(
              "min-h-11 shrink-0 rounded-full border px-5 text-sm font-semibold transition-colors",
              item === filter
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {item}
          </button>
        ))}
      </div>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <p className="text-sm">
            We couldn’t refresh events. Please try again.
          </p>
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            className="min-h-11 px-3 text-sm font-bold text-primary"
          >
            Try again
          </button>
        </div>
      )}
      <section aria-label="Events">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="font-yrdly-display text-2xl font-bold">
            {filter === "All"
              ? "Find your next outing"
              : filter === "Free"
                ? "Free to join"
                : filter}
          </h2>
          <span
            role="status"
            className="shrink-0 text-xs text-muted-foreground"
          >
            {loading
              ? "Refreshing…"
              : `${visible.length} ${visible.length === 1 ? "event" : "events"}`}
          </span>
        </div>
        {loading && events.length === 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-80 rounded-[26px]" />
            ))}
          </div>
        ) : visible.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((event) => (
              <EventCard
                key={event.id}
                event={
                  {
                    ...event,
                    image_url: event.cover_image_url,
                    event_date: event.start_time,
                    event_location: event.location_address,
                  } as any
                }
                onPress={() => router.push(`/events/${event.id}`)}
              />
            ))}
          </div>
        ) : (
          !error && (
            <div className="flex flex-col items-center rounded-[26px] border border-dashed border-border px-6 py-16 text-center">
              <SlidersHorizontal className="mb-4 h-9 w-9 text-primary" />
              <h3 className="font-yrdly-display text-2xl font-bold">
                {query || filter !== "All"
                  ? "No matches just yet."
                  : "A little quiet around here."}
              </h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {query || filter !== "All"
                  ? "Try another search or explore all events."
                  : "Bring people together. Create an event or check back for something new."}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (query || filter !== "All") {
                    setQuery("");
                    setFilter("All");
                  } else create();
                }}
                className="mt-5 min-h-11 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"
              >
                {query || filter !== "All"
                  ? "Clear filters"
                  : "Create an event"}
              </button>
            </div>
          )
        )}
      </section>
      <EventCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onContinue={() => router.push("/events/create")}
      />
    </div>
  );
}
