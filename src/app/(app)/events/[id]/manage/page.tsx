"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Users, TicketCheck, DollarSign, QrCode, Search, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { getEventById, getEventTickets } from "@/lib/event-service";
import type { Event, Ticket } from "@/types/events";
import { EVENT_CONSTANTS } from "@/lib/constants";

type CheckInResult = { valid: boolean; message: string; attendee_name?: string; tier_name?: string } | null;

export default function ManageEventPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "attendees" | "checkin">("overview");
  const [ticketCode, setTicketCode] = useState("");
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInResult, setCheckInResult] = useState<CheckInResult>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([getEventById(id), getEventTickets(id)]).then(([e, t]) => {
      if (!e || e.organizer_id !== user?.id) { router.replace("/events"); return; }
      setEvent(e); setTickets(t); setLoading(false);
    });
  }, [id, user, router]);

  // ── Supabase Realtime subscription for live ticket updates ──────────────────
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`tickets:${id}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'tickets',
          filter: `event_id=eq.${id}`,
        },
        (payload) => {
          console.log('[v0] Realtime ticket update:', payload);
          // Refetch tickets to keep stats in sync
          getEventTickets(id).then((updatedTickets) => {
            if (updatedTickets) {
              setTickets(updatedTickets);
            }
          });
        }
      )
      .subscribe((status) => {
        console.log('[v0] Realtime subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const handleCheckIn = async () => {
    if (!ticketCode.trim()) return;
    setCheckInLoading(true); setCheckInResult(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setCheckInLoading(false); return; }
    const res = await fetch("/api/events/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ ticket_code: ticketCode.trim().toUpperCase(), event_id: id }),
    });
    const data = await res.json();
    setCheckInResult(data);
    if (data.valid) {
      setTickets(prev => prev.map(t => t.ticket_code === ticketCode.trim().toUpperCase() ? { ...t, status: "USED" as const } : t));
      setTicketCode("");
    }
    setCheckInLoading(false);
  };

  if (loading) return <div className="min-h-[100dvh] bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  if (!event) return null;

  const gross = tickets.filter(t => t.status !== "REFUNDED" && t.status !== "CANCELLED").reduce((s, t) => s + Number(t.amount_paid), 0);
  const net = Math.round(gross * (1 - EVENT_CONSTANTS.COMMISSION_RATE) * 100) / 100;
  const used = tickets.filter(t => t.status === "USED").length;
  const paid = tickets.filter(t => t.status === "PAID").length;

  const filtered = tickets.filter(t =>
    !search || t.attendee_name.toLowerCase().includes(search.toLowerCase()) ||
    t.attendee_email.toLowerCase().includes(search.toLowerCase()) ||
    t.ticket_code?.toLowerCase().includes(search.toLowerCase())
  );

  const statusColor: Record<string, string> = {
    PAID: "bg-green-500/20 text-green-400 border-green-500/30",
    USED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    REFUNDED: "bg-red-500/20 text-red-400 border-red-500/30",
    CANCELLED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pb-16">
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] z-40 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="font-sans font-bold text-base text-foreground truncate">{event.title}</h1>
          <p className="font-sans text-xs text-muted-foreground">{event.status}</p>
        </div>
      </div>

      <div className="flex border-b border-border px-4">
        {(["overview", "attendees", "checkin"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 font-sans text-sm capitalize border-b-2 transition-colors ${activeTab === tab ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground"}`}>
            {tab === "checkin" ? "Check-in" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-5 space-y-4">
        {activeTab === "overview" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Tickets Sold", value: tickets.filter(t => t.status !== "CANCELLED").length, icon: Users },
                { label: "Checked In", value: used, icon: TicketCheck },
                { label: "Gross Revenue", value: `₦${gross.toLocaleString()}`, icon: DollarSign },
                { label: "Net Payout", value: `₦${net.toLocaleString()}`, icon: DollarSign },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-2xl bg-card border border-border p-4">
                  <Icon className="w-5 h-5 mb-2 text-[#4CAF50]" />
                  <p className="font-sans font-bold text-xl text-foreground">{value}</p>
                  <p className="font-sans text-xs text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-primary/10 border border-primary/20 p-3">
              <p className="font-sans text-xs text-muted-foreground">
                2% platform fee deducted. Net payout of ₦{net.toLocaleString()} released {EVENT_CONSTANTS.AUTO_RELEASE_HOURS}h after event ends.
              </p>
            </div>
          </>
        )}

        {activeTab === "attendees" && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-foreground font-sans text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                placeholder="Search name, email or code…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="space-y-2">
              {filtered.length === 0 ? (
                <div className="rounded-2xl bg-card border border-border py-12 flex flex-col items-center gap-2">
                  <Users className="w-10 h-10 text-muted-foreground" />
                  <p className="font-sans text-sm text-muted-foreground">{search ? "No results" : "No tickets sold yet"}</p>
                </div>
              ) : filtered.map(ticket => (
                <div key={ticket.id} className="rounded-xl bg-card border border-border p-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-sans font-semibold text-sm text-foreground truncate">{ticket.attendee_name}</p>
                    <p className="font-sans text-xs text-muted-foreground truncate">{ticket.attendee_email}</p>
                    <p className="font-sans text-xs text-muted-foreground font-mono mt-0.5">{ticket.ticket_code}</p>
                  </div>
                  <Badge className={`text-xs font-sans border ${statusColor[ticket.status] || statusColor.CANCELLED}`}>
                    {ticket.status}
                  </Badge>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === "checkin" && (
          <>
            <div className="rounded-2xl bg-card border border-border p-5 space-y-4">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-primary" />
                <h3 className="font-sans font-bold text-sm text-foreground">Enter Ticket Code</h3>
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-background border border-border rounded-xl px-4 py-3 text-foreground font-mono text-sm placeholder:text-muted-foreground outline-none focus:border-primary uppercase"
                  placeholder="YRD-XXXXXXXX"
                  value={ticketCode}
                  onChange={e => { setTicketCode(e.target.value.toUpperCase()); setCheckInResult(null); }}
                  onKeyDown={e => e.key === "Enter" && handleCheckIn()}
                />
                <Button onClick={handleCheckIn} disabled={!ticketCode.trim() || checkInLoading}
                  className="rounded-xl font-sans text-sm text-foreground px-5" style={{ background: "hsl(var(--primary))" }}>
                  {checkInLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check In"}
                </Button>
              </div>
              {checkInResult && (
                <div className={`rounded-xl p-4 flex items-start gap-3 ${checkInResult.valid ? "bg-primary/15 border border-primary/30" : "bg-red-500/15 border border-red-500/30"}`}>
                  {checkInResult.valid ? <CheckCircle2 className="w-5 h-5 text-[#4CAF50] flex-shrink-0" /> : <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />}
                  <div>
                    <p className={`font-sans font-bold text-sm ${checkInResult.valid ? "text-[#4CAF50]" : "text-red-400"}`}>{checkInResult.message}</p>
                    {checkInResult.attendee_name && <p className="font-sans text-xs text-muted-foreground mt-0.5">{checkInResult.attendee_name} · {checkInResult.tier_name}</p>}
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[{ label: "Checked In", value: used, color: "text-blue-400" }, { label: "Remaining", value: paid, color: "text-foreground" }].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl bg-card border border-border p-4 text-center">
                  <p className={`font-sans font-bold text-3xl ${color}`}>{value}</p>
                  <p className="font-sans text-xs text-muted-foreground mt-1">{label}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
