"use client";

import { EventPaystackEarnings } from "@/components/events/EventPaystackEarnings";
import { EventPageIntro } from "@/components/events/EventPageIntro";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase/supabase";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Ticket as TicketIcon,
  Search,
  QrCode,
  Lock,
  Loader2,
  CheckCircle2,
  Users,
  Clock,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/shared/utils";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";

interface EventData {
  id: string;
  organizer_id: string;
  title: string;
  description: string;
  category: string;
  cover_image_url?: string;
  start_time: string;
  end_time: string;
  location_address?: string;
  location_online?: boolean;
  online_link?: string;
  status: string;
  ticket_tiers?: Array<{ id: string; name: string; price: number }>;
}

interface TicketData {
  id: string;
  event_id: string;
  user_id: string;
  user_name?: string;
  attendee_name?: string;
  amount_paid?: number;
  status: "PAID" | "USED" | "CANCELLED" | "PENDING" | "REFUNDED";
  payment_provider?: string | null;
  refund_status?: string | null;
  created_at: string;
  scanned_at?: string;
  tier?: {
    id: string;
    name: string;
    price: number;
  };
}

export default function ManageEventPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const { user } = useAuth();
  const [event, setEvent] = useState<EventData | null>(null);
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const cancellationInFlight = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const refundInFlight = useRef(false);
  const [refundMessage, setRefundMessage] = useState("");
  const [earningsRevision, setEarningsRevision] = useState(0);

  const handleCancelEvent = async () => {
    if (!id || cancellationInFlight.current) return;
    cancellationInFlight.current = true;
    setCancelling(true);
    setCancelError("");
    try {
      await authenticatedFetch(`/api/events/${id}/cancel`, {});
      setCancelModalOpen(false);
      await fetchData();
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : "Failed to cancel event",
      );
    } finally {
      cancellationInFlight.current = false;
      setCancelling(false);
    }
  };

  const fetchData = useCallback(async () => {
    if (!id || !user) {
      setLoading(false);
      setRefreshing(false);
      setAccessDenied(true);
      return;
    }
    setLoadError(false);
    setAccessDenied(false);
    try {
      // 1. Fetch Event and verify organizer permission
      const { data: eventData, error: eventError } = await supabase
        .from("events")
        .select("*, ticket_tiers(*)")
        .eq("id", id)
        .maybeSingle();

      if (eventError) throw eventError;

      if (!eventData || eventData.organizer_id !== user.id) {
        setAccessDenied(true);
        return;
      }

      setEvent(eventData as EventData);

      // 2. Fetch Tickets for attendee roster
      const { data: ticketData, error: ticketError } = await supabase
        .from("tickets")
        .select("*, tier:ticket_tiers(id, name, price)")
        .eq("event_id", id)
        .order("created_at", { ascending: false });

      if (ticketError) throw ticketError;
      setTickets((ticketData || []) as TicketData[]);
    } catch (err) {
      setLoadError(true);
      console.error("Failed to load organizer event details:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefund = async (ticket: TicketData) => {
    if (
      refundInFlight.current ||
      ticket.status !== "PAID" ||
      ticket.payment_provider !== "paystack" ||
      ticket.refund_status
    )
      return;
    if (
      !window.confirm(
        `Request a refund of ₦${Number(ticket.amount_paid || 0).toLocaleString("en-NG")} for ${ticket.attendee_name || "this attendee"}? The ticket will be blocked from entry while the refund is processed.`,
      )
    )
      return;
    refundInFlight.current = true;
    setRefundingId(ticket.id);
    setRefundMessage("");
    try {
      const result = await authenticatedFetch<{
        refund?: { status: string };
        message?: string;
      }>("/api/events/tickets/refund", { ticket_id: ticket.id });
      const status = result.refund?.status;
      setTickets((current) =>
        current.map((row) =>
          row.id === ticket.id
            ? {
                ...row,
                refund_status: status || "pending",
                ...(status === "processed"
                  ? { status: "REFUNDED" as const }
                  : {}),
              }
            : row,
        ),
      );
      setRefundMessage(
        status === "processed"
          ? "Refund confirmed."
          : ["failed", "review", "needs-attention"].includes(status || "")
            ? "This refund needs support review. The ticket remains blocked from entry."
            : "Refund requested. Refresh the roster to check confirmation.",
      );
    } catch (error) {
      setRefundMessage(
        error instanceof Error
          ? error.message
          : "The refund could not be confirmed. Refresh its status before trying again.",
      );
    } finally {
      await fetchData();
      setEarningsRevision((value) => value + 1);
      refundInFlight.current = false;
      setRefundingId(null);
    }
  };

  // Compute KPI Metrics
  const metrics = useMemo(() => {
    const paidTickets = tickets.filter(
      (ticket) => ticket.status === "PAID" || ticket.status === "USED",
    );
    return {
      sold: paidTickets.length,
      checkedIn: tickets.filter((ticket) => ticket.status === "USED").length,
      revenue: paidTickets.reduce(
        (sum, ticket) => sum + Number(ticket.amount_paid || 0),
        0,
      ),
    };
  }, [tickets]);

  // Filtered Roster
  const filteredTickets = useMemo(() => {
    if (!searchQuery.trim()) return tickets;
    const q = searchQuery.toLowerCase();
    return tickets.filter((t) => {
      const name = (t.attendee_name || t.user_name || "Guest").toLowerCase();
      const tierName = (t.tier?.name || "").toLowerCase();
      const status = t.status.toLowerCase();
      return name.includes(q) || tierName.includes(q) || status.includes(q);
    });
  }, [tickets, searchQuery]);

  if (loading) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
        <p className="text-sm text-muted-foreground">
          Loading organizer event dashboard...
        </p>
      </div>
    );
  }

  if (loadError && !event) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p role="alert">We could not load this event.</p>
        <Button onClick={() => void fetchData()}>Try again</Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Go back
        </Button>
      </div>
    );
  }

  if (accessDenied || !event) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold font-sans text-foreground mb-2">
          Organizer Access Only
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Only the event organizer can view ticket buyers, revenue metrics, and
          check-ins.
        </p>
        <Button
          onClick={() => router.back()}
          className="rounded-full px-8 bg-primary text-foreground font-sans font-bold hover:bg-primary/90"
        >
          Go Back
        </Button>
      </div>
    );
  }

  const canCheckIn =
    event.status === "PUBLISHED" &&
    !loadError &&
    Number.isFinite(Date.parse(event.end_time)) &&
    Date.parse(event.end_time) > Date.now();

  const startDateFormatted = new Date(event.start_time).toLocaleDateString(
    "en-NG",
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  );
  const startTimeFormatted = new Date(event.start_time).toLocaleTimeString(
    "en-NG",
    {
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              aria-label="Back"
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="rounded-full hover:bg-secondary"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-bold font-sans text-foreground truncate">
              Manage: {event.title}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRefreshing(true);
                fetchData();
              }}
              disabled={refreshing}
              className="rounded-full font-bold text-xs gap-1.5"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", refreshing && "animate-spin")}
              />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push(`/events/${id}/team`)}
            >
              Event team
            </Button>
            {canCheckIn && (
              <Button
                onClick={() => router.push(`/events/${id}/scan`)}
                className="rounded-full bg-primary text-foreground font-bold text-xs gap-1.5 hover:bg-primary/90"
              >
                <QrCode className="w-4 h-4" />
                Ticket Scanner
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {loadError && (
          <p
            role="alert"
            className="rounded-2xl border border-border p-4 text-sm"
          >
            Could not refresh this event. Use Refresh to try again.
          </p>
        )}
        <EventPageIntro
          eyebrow="THE HOST DESK"
          title="Every detail, in one place."
          description="Track attendance, review your event and welcome guests. Your event’s current status is shown below."
        />
        {/* Event Summary Banner */}
        <div className="p-5 rounded-3xl border border-border bg-card flex flex-col sm:flex-row gap-5 items-start sm:items-center justify-between">
          <div className="flex items-center gap-4">
            {event.cover_image_url ? (
              <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-secondary shrink-0 border border-border">
                <Image
                  src={event.cover_image_url}
                  alt={event.title}
                  fill
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center shrink-0 border border-border">
                <Calendar className="w-8 h-8 text-muted-foreground/50" />
              </div>
            )}

            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {event.category || "Event"}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                  Status: {event.status}
                </span>
              </div>
              <h2 className="text-xl font-bold font-sans text-foreground mt-0.5">
                {event.title}
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-primary" />{" "}
                  {startDateFormatted} at {startTimeFormatted}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-primary" />{" "}
                  {event.location_online
                    ? "Online Event"
                    : event.location_address || "Venue"}
                </span>
              </div>
            </div>
          </div>

          {event.status !== "CANCELLED" && event.status !== "COMPLETED" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCancelError("");
                setCancelModalOpen(true);
              }}
              className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 text-xs gap-1.5 font-bold shrink-0"
            >
              <XCircle className="w-4 h-4" />
              Cancel Event
            </Button>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-destructive/10 text-destructive border border-destructive/30">
              {event.status}
            </span>
          )}
        </div>

        {/* 3 KPI Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Metric 1: Tickets Sold */}
          <Card className="rounded-3xl border-border">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Tickets Sold
                </p>
                <h3 className="text-3xl font-extrabold font-sans text-foreground mt-1">
                  {metrics.sold}
                </h3>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <TicketIcon className="w-6 h-6 text-primary" />
              </div>
            </CardContent>
          </Card>

          {/* Metric 2: Revenue */}
          <Card className="rounded-3xl border-border">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Gross Revenue
                </p>
                <h3 className="text-3xl font-extrabold font-sans text-foreground mt-1">
                  ₦{metrics.revenue.toLocaleString()}
                </h3>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <span
                  aria-label="Naira"
                  className="text-2xl font-bold leading-none text-emerald-500"
                >
                  ₦
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Metric 3: Checked In */}
          <Card className="rounded-3xl border-border">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Checked In
                </p>
                <h3 className="text-3xl font-extrabold font-sans text-foreground mt-1">
                  {metrics.checkedIn}
                </h3>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        <EventPaystackEarnings key={earningsRevision} eventId={id} />

        {/* Ticket Buyer Roster */}
        <div className="p-6 rounded-3xl border border-border bg-card space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold font-sans text-foreground">
                Attendee Roster
              </h3>
              <p className="text-xs text-muted-foreground">
                View and search ticket buyers and check-in statuses.
              </p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search buyer name or tier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 rounded-full text-xs"
              />
            </div>
          </div>

          {filteredTickets.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground space-y-2">
              <TicketIcon className="w-10 h-10 mx-auto opacity-30" />
              <p className="text-sm font-medium">
                No tickets found matching search query.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border border-t border-border pt-2">
              {refundMessage && (
                <p role="status" className="py-3 text-sm text-muted-foreground">
                  {refundMessage}
                </p>
              )}
              {filteredTickets.map((t) => {
                const isCheckedIn = t.status === "USED";
                const isPaid = t.status === "PAID" || t.status === "USED";

                return (
                  <div
                    key={t.id}
                    className="py-3 flex items-center justify-between gap-4 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground truncate">
                          {t.attendee_name || t.user_name || "Guest Attendee"}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-secondary text-secondary-foreground">
                          {t.tier?.name || "General Admission"}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Booked{" "}
                        {new Date(t.created_at).toLocaleDateString("en-NG", {
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        • ₦{Number(t.amount_paid || 0).toLocaleString()}
                      </p>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-2">
                      {t.refund_status ? (
                        <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-muted text-muted-foreground">
                          {t.refund_status === "processed"
                            ? "Refunded"
                            : ["failed", "review", "needs-attention"].includes(
                                  t.refund_status,
                                )
                              ? "Refund needs review"
                              : "Refund pending"}
                        </span>
                      ) : isCheckedIn ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Checked In
                        </span>
                      ) : isPaid ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                          <Clock className="w-3.5 h-3.5" /> Valid Ticket
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-muted text-muted-foreground">
                          {t.status}
                        </span>
                      )}
                      {t.payment_provider === "paystack" &&
                        t.status === "PAID" &&
                        !t.refund_status && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={refundingId !== null}
                            onClick={() => void handleRefund(t)}
                          >
                            {refundingId === t.id
                              ? "Requesting…"
                              : "Refund ticket"}
                          </Button>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Cancel Event Confirmation Modal */}
      <Dialog
        open={cancelModalOpen}
        onOpenChange={(open) => {
          if (!cancelling) setCancelModalOpen(open);
        }}
      >
        <DialogContent className="rounded-3xl p-6 max-w-md space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-destructive">
              <XCircle className="w-6 h-6 shrink-0" />
              Cancel Event
            </DialogTitle>
            <DialogDescription>
              Cancel <strong className="text-foreground">{event.title}</strong>?
              Ticket purchases will stop and attendees will be notified.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            All paid tickets must have confirmed refunds first. Refund them from
            the attendee roster and refresh their status before cancelling.
            Checked-in tickets require support review. Free tickets will no
            longer admit guests.
          </p>
          {cancelError && (
            <p role="alert" className="text-sm text-destructive">
              {cancelError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCancelModalOpen(false)}
              disabled={cancelling}
              className="rounded-full text-xs"
            >
              Go Back
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelEvent}
              disabled={cancelling}
              className="rounded-full text-xs gap-1.5 font-bold"
            >
              {cancelling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Yes, Cancel Event"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
