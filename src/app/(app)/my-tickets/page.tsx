"use client";

import { TicketEntryCode } from "@/components/events/TicketEntryCode";

import { EventPageIntro } from "@/components/events/EventPageIntro";

import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Ticket,
  CalendarDays,
  MapPin,
  QrCode,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-supabase-auth";
import { getMyTickets } from "@/lib/events/event-service";
import { getEventTicketPresentation } from "@/lib/events/event-ticket-presentation";
import type { Ticket as TicketType } from "@/types/events";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const statusStyle: Record<string, string> = {
  success: "bg-green-500/20 text-green-400 border-green-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  muted: "bg-muted text-muted-foreground border-border",
};

export default function MyTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id;
  const [tickets, setTickets] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TicketType | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshEpoch = useRef(0);
  const selectedInfo = selected ? getEventTicketPresentation(selected) : null;

  const refreshTickets = async () => {
    if (!userId || refreshing) return;
    const epoch = ++refreshEpoch.current;
    setRefreshing(true);
    try {
      const records = await getMyTickets(userId);
      if (epoch !== refreshEpoch.current) return;
      setTickets(records);
      setSelected((current) =>
        current
          ? records.find((ticket) => ticket.id === current.id) || null
          : null,
      );
      setLoadError(false);
    } catch {
      if (epoch === refreshEpoch.current) setLoadError(true);
    } finally {
      if (epoch === refreshEpoch.current) setRefreshing(false);
    }
  };

  const justPurchased = searchParams.get("success") === "1";
  const txRefParam = searchParams.get("tx_ref");

  useEffect(() => {
    refreshEpoch.current += 1;
    setRefreshing(false);
    let current = true;
    setSelected(null);
    setTickets([]);
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    const loadTickets = async () => {
      if (txRefParam) {
        try {
          await authenticatedFetch("/api/events/tickets/verify", {
            tx_ref: txRefParam,
          });
        } catch {
          /* Existing payment state remains authoritative in the ticket response. */
        }
      }
      try {
        const records = await getMyTickets(userId);
        if (current) setTickets(records);
      } catch {
        if (current) setLoadError(true);
      } finally {
        if (current) setLoading(false);
      }
    };
    void loadTickets();
    return () => {
      refreshEpoch.current += 1;
      current = false;
    };
  }, [userId, txRefParam, reload]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground pb-24">
        <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] lg:top-0 z-40 bg-card border-b border-border shadow-sm px-4 py-4 flex items-center gap-3">
          <Skeleton className="h-9 w-9 bg-muted rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32 bg-muted" />
            <Skeleton className="h-3 w-16 bg-muted" />
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-full rounded-2xl bg-card border border-border overflow-hidden"
            >
              <Skeleton className="h-32 w-full bg-muted" />
              <div className="p-4 flex items-start justify-between gap-3">
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-5 w-3/4 bg-muted" />
                  <Skeleton className="h-4 w-1/2 bg-muted" />
                  <div className="flex gap-2 mt-2">
                    <Skeleton className="h-6 w-16 bg-muted rounded-full" />
                    <Skeleton className="h-6 w-16 bg-muted rounded-full" />
                  </div>
                </div>
                <Skeleton className="h-8 w-8 bg-muted rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pb-24">
      {/* Header */}
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] lg:top-0 z-40 flex items-center gap-3 px-4 py-4 bg-card border-b border-border shadow-sm">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div>
          <h1 className="font-yrdly-display font-bold text-xl text-foreground">
            My Tickets
          </h1>
          <p className="font-sans text-xs text-muted-foreground mt-0.5">
            {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void refreshTickets()}
          className="ml-auto min-h-11 text-sm font-semibold text-primary disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Success banner */}
      {justPurchased && (
        <div className="mx-4 mt-4 rounded-2xl bg-primary/15 border border-primary/30 p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-[#4CAF50] flex-shrink-0" />
          <div>
            <p className="font-sans font-bold text-sm text-[#4CAF50]">
              Ticket Confirmed!
            </p>
            <p className="font-sans text-xs text-muted-foreground">
              Open your ticket below to see its entry code.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">
        <EventPageIntro
          eyebrow="YOUR NEXT GOOD TIME"
          title="Tickets, ready to go."
          description="Open a ticket to see its details and entry code. Keep it handy when you arrive."
        />
        {loadError && (
          <div
            role="alert"
            className="rounded-2xl border border-border bg-card p-5"
          >
            Couldn’t load your tickets.{" "}
            <button
              type="button"
              onClick={() => setReload((value) => value + 1)}
              className="min-h-11 font-bold text-primary"
            >
              Try again
            </button>
          </div>
        )}
        {!loadError && tickets.length === 0 ? (
          <div
            className="text-center p-8 md:p-12 rounded-2xl mx-4 my-6"
            style={{
              background: "var(--c-card)",
              border: "1px solid var(--c-border)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
          >
            <div className="flex justify-center mb-6">
              <span
                className="text-5xl"
                role="img"
                aria-label="Ticket"
                style={{ animationDuration: "2s" }}
              >
                🎫
              </span>
            </div>

            <h2
              className="text-2xl font-extrabold mb-3"
              style={{
                fontFamily: "var(--font-jersey25)",
                color: "var(--c-text)",
                letterSpacing: "-0.02em",
              }}
            >
              No tickets yet!
            </h2>

            <p
              className="mb-8 max-w-sm mx-auto text-[0.9375rem] leading-relaxed"
              style={{
                fontFamily: "var(--font-work-sans)",
                color: "var(--c-text-muted)",
              }}
            >
              Purchase tickets to local events and they&apos;ll appear here.
            </p>

            <Link href="/events">
              <button
                className="w-full sm:w-auto px-8 py-3.5 rounded-full flex items-center justify-center text-foreground font-bold mx-auto transition-all active:scale-95 shadow-[0_8px_20px_rgba(56,142,60,0.25)] hover:shadow-[0_10px_25px_rgba(56,142,60,0.35)]"
                style={{
                  background: "hsl(var(--primary))",
                  fontFamily: "var(--font-work-sans)",
                  letterSpacing: "0.02em",
                }}
              >
                Browse Events
              </button>
            </Link>
          </div>
        ) : (
          tickets.map((ticket) => {
            const event = ticket.event as any;
            const tier = ticket.tier as any;
            const info = getEventTicketPresentation(ticket);
            const ss = { label: info.label, cls: statusStyle[info.tone] };
            return (
              <button
                key={ticket.id}
                onClick={() => setSelected(ticket)}
                className="w-full text-left rounded-[26px] bg-card border border-border overflow-hidden hover:border-primary focus-visible:ring-2 focus-visible:ring-primary transition-colors"
              >
                {/* Event image strip */}
                {event?.cover_image_url && (
                  <div className="relative w-full h-32 bg-background">
                    <Image
                      src={event.cover_image_url}
                      alt={event.title || ""}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--c-card)]/80 to-transparent" />
                  </div>
                )}
                <div className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-yrdly-display font-bold text-xl text-foreground truncate">
                      {event?.title || "Event"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5 text-muted-foreground">
                      <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-sans text-xs">
                        {event?.start_time ? formatDate(event.start_time) : "—"}
                      </span>
                    </div>
                    {(event?.location_address || event?.state) && (
                      <div className="flex items-center gap-1.5 mt-1 text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="font-sans text-xs truncate">
                          {event.location_address || event.state}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      <Badge className={`text-xs font-sans border ${ss.cls}`}>
                        {ss.label}
                      </Badge>
                      {ticket.is_test_payment && (
                        <Badge className="text-xs border border-amber-500/30 bg-amber-500/20 text-amber-400">
                          Sandbox · no real payment
                        </Badge>
                      )}
                      {tier && (
                        <span className="font-sans text-xs text-muted-foreground">
                          {tier.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <QrCode className="w-5 h-5 text-muted-foreground" />
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Ticket detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-[110] bg-black/80 flex items-end justify-center"
          onClick={() => setSelected(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-detail-title"
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-card border border-border p-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3
                id="ticket-detail-title"
                className="font-sans font-bold text-base text-foreground"
              >
                {(selected.event as any)?.title || "Ticket"}
              </h3>
              <button
                aria-label="Close ticket details"
                onClick={() => setSelected(null)}
                className="min-h-11 min-w-11 text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* QR Code */}
            {selectedInfo?.isValid && !loadError ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <TicketEntryCode token={selected.qr_data || selected.id} />
                <p className="font-mono text-xs text-muted-foreground">
                  {selected.ticket_code}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8">
                <AlertCircle className="w-10 h-10 text-muted-foreground" />
                <p className="font-sans text-xs text-muted-foreground">
                  {loadError
                    ? "Could not update this ticket. Refresh before entry."
                    : selectedInfo?.message}
                </p>
              </div>
            )}

            {selected.is_test_payment && (
              <p className="text-sm text-amber-500">
                Sandbox · no real payment
              </p>
            )}
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void refreshTickets()}
              className="min-h-11 font-semibold text-primary disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh ticket status"}
            </button>
            <p className="text-sm text-muted-foreground">
              For ticket questions or a refund request, contact the organiser
              from the event page.
            </p>
            <Link
              href={`/events/${selected.event_id}`}
              className="flex min-h-11 items-center justify-center rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground"
            >
              View event and contact organiser
            </Link>

            {/* Ticket details */}
            <div className="space-y-2 border-t border-border pt-4">
              {[
                {
                  label: "Ticket Type",
                  value: (selected.tier as any)?.name || "—",
                },
                { label: "Attendee", value: selected.attendee_name },
                {
                  label: "Amount Paid",
                  value:
                    selected.amount_paid === 0
                      ? "Free"
                      : `₦${Number(selected.amount_paid).toLocaleString()}`,
                },
                {
                  label: "Status",
                  value: selectedInfo?.label || "Unavailable",
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="font-sans text-xs text-muted-foreground">
                    {label}
                  </span>
                  <span className="font-sans text-xs text-foreground font-medium">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
