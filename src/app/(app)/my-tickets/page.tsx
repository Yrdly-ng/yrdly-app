"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Ticket, CalendarDays, MapPin, QrCode, ChevronRight, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-supabase-auth";
import { getMyTickets } from "@/lib/event-service";
import type { Ticket as TicketType } from "@/types/events";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const statusStyle: Record<string, { label: string; cls: string }> = {
  PAID: { label: "Active", cls: "bg-green-500/20 text-green-400 border-green-500/30" },
  USED: { label: "Used", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  REFUNDED: { label: "Refunded", cls: "bg-red-500/20 text-red-400 border-red-500/30" },
  CANCELLED: { label: "Cancelled", cls: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
};

export default function MyTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [tickets, setTickets] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TicketType | null>(null);

  const justPurchased = searchParams.get("success") === "1";

  useEffect(() => {
    if (!user) return;
    getMyTickets(user.id).then(t => { setTickets(t); setLoading(false); });
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground pb-24">
        <div className="sticky top-0 z-50 bg-background/95 border-b border-border px-4 py-4 flex items-center gap-3">
          <Skeleton className="h-9 w-9 bg-muted rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32 bg-muted" />
            <Skeleton className="h-3 w-16 bg-muted" />
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="w-full rounded-2xl bg-card border border-border overflow-hidden">
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
      <div className="sticky top-0 z-50 flex items-center gap-3 px-4 py-4 bg-background/95 backdrop-blur-sm border-b border-border">
        <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div>
          <h1 className="font-sans font-bold text-xl text-foreground">My Tickets</h1>
          <p className="font-sans text-xs text-muted-foreground mt-0.5">{tickets.length} ticket{tickets.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Success banner */}
      {justPurchased && (
        <div className="mx-4 mt-4 rounded-2xl bg-[#388E3C]/15 border border-[#388E3C]/30 p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-[#4CAF50] flex-shrink-0" />
          <div>
            <p className="font-sans font-bold text-sm text-[#4CAF50]">Ticket Confirmed!</p>
            <p className="font-sans text-xs text-muted-foreground">Check your email for your QR code.</p>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">
        {tickets.length === 0 ? (
          <div className="rounded-2xl bg-card border border-border py-16 flex flex-col items-center gap-3">
            <Ticket className="w-14 h-14 text-muted-foreground" />
            <p className="font-sans font-semibold text-sm text-muted-foreground">No tickets yet</p>
            <p className="font-sans text-xs text-muted-foreground text-center max-w-[220px]">
              Purchase tickets to local events and they&apos;ll appear here.
            </p>
            <Link href="/events">
              <button className="mt-2 px-6 py-2.5 rounded-full bg-[#388E3C] font-sans text-sm text-foreground font-medium">
                Explore Events
              </button>
            </Link>
          </div>
        ) : (
          tickets.map(ticket => {
            const event = ticket.event as any;
            const tier = ticket.tier as any;
            const ss = statusStyle[ticket.status] || statusStyle.CANCELLED;
            return (
              <button
                key={ticket.id}
                onClick={() => setSelected(ticket)}
                className="w-full text-left rounded-2xl bg-card border border-border overflow-hidden hover:border-border transition-colors"
              >
                {/* Event image strip */}
                {event?.cover_image_url && (
                  <div className="relative w-full h-32 bg-background">
                    <Image src={event.cover_image_url} alt={event.title || ""} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--c-card)]/80 to-transparent" />
                  </div>
                )}
                <div className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-sans font-bold text-base text-foreground truncate">{event?.title || "Event"}</p>
                    <div className="flex items-center gap-1.5 mt-1.5 text-muted-foreground">
                      <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-sans text-xs">{event?.start_time ? formatDate(event.start_time) : "—"}</span>
                    </div>
                    {(event?.location_address || event?.state) && (
                      <div className="flex items-center gap-1.5 mt-1 text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="font-sans text-xs truncate">{event.location_address || event.state}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      <Badge className={`text-xs font-sans border ${ss.cls}`}>{ss.label}</Badge>
                      {tier && <span className="font-sans text-xs text-muted-foreground">{tier.name}</span>}
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
          className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-card border border-border p-6 space-y-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-sans font-bold text-base text-foreground">
                {(selected.event as any)?.title || "Ticket"}
              </h3>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">✕</button>
            </div>

            {/* QR Code */}
            {selected.qr_data ? (
              <div className="flex flex-col items-center gap-3 py-4">
                {/* We show a generated QR using an img tag with a QR service fallback */}
                <Image
                  src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(selected.qr_data)}&size=220x220&bgcolor=1E2126&color=FFFFFF`}
                  alt="Ticket QR Code"
                  width={220}
                  height={220}
                  className="rounded-xl"
                  unoptimized
                />
                <p className="font-mono text-xs text-muted-foreground">{selected.ticket_code}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8">
                <AlertCircle className="w-10 h-10 text-muted-foreground" />
                <p className="font-sans text-xs text-muted-foreground">QR code not available</p>
              </div>
            )}

            {/* Ticket details */}
            <div className="space-y-2 border-t border-border pt-4">
              {[
                { label: "Ticket Type", value: (selected.tier as any)?.name || "—" },
                { label: "Attendee", value: selected.attendee_name },
                { label: "Amount Paid", value: selected.amount_paid === 0 ? "Free" : `₦${Number(selected.amount_paid).toLocaleString()}` },
                { label: "Status", value: statusStyle[selected.status]?.label || selected.status },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="font-sans text-xs text-muted-foreground">{label}</span>
                  <span className="font-sans text-xs text-foreground font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
