"use client";

import React, { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, QrCode, CheckCircle2, XCircle, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const FONT = "var(--font-work-sans), sans-serif";
const RALEWAY = "var(--font-raleway), sans-serif";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EventScanTicketPage({ params }: PageProps) {
  const { id: eventId } = use(params);
  const router = RouterHook();
  const { user } = useAuth();

  const [eventTitle, setEventTitle] = useState<string>("");
  const [ticketInput, setTicketInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<{
    success?: boolean;
    reason?: string;
    attendee_name?: string;
    ticket_code?: string;
    scanned_at?: string;
  } | null>(null);

  function RouterHook() {
    return useRouter();
  }

  useEffect(() => {
    if (!eventId) return;
    supabase
      .from("events")
      .select("title")
      .eq("id", eventId)
      .single()
      .then(({ data }) => {
        if (data?.title) setEventTitle(data.title);
      });
  }, [eventId]);

  const handleScanSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!ticketInput.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/tickets/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketInput: ticketInput.trim(),
          eventId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setResult({ success: false, reason: data.error || "Failed to scan ticket" });
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setResult({ success: false, reason: err.message || "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setTicketInput("");
    setResult(null);
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-6" style={{ fontFamily: FONT }}>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="font-bold text-xl text-foreground" style={{ fontFamily: RALEWAY }}>
            Scan & Check-In Tickets
          </h1>
          <p className="text-xs text-muted-foreground">{eventTitle || "Event Ticket Verification"}</p>
        </div>
      </div>

      <Card className="rounded-2xl border border-border/40 shadow-sm bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" />
            Enter Ticket Code or ID
          </CardTitle>
          <CardDescription className="text-xs">
            Scan QR code string or manually type attendee ticket ID/code to check in attendee.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleScanSubmit} className="flex gap-2">
            <Input
              placeholder="e.g. TC-89X12A or Ticket UUID"
              value={ticketInput}
              onChange={(e) => setTicketInput(e.target.value)}
              className="rounded-xl font-mono text-sm"
              disabled={loading}
              autoFocus
            />
            <Button type="submit" disabled={loading || !ticketInput.trim()} className="rounded-xl px-5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
            </Button>
          </form>

          {result && (
            <div className="pt-2">
              {result.success ? (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-base">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                    Valid Ticket - Checked In!
                  </div>
                  <div className="text-sm space-y-1 pl-8">
                    <p>
                      <span className="font-medium text-muted-foreground">Attendee:</span>{" "}
                      <span className="font-bold text-foreground">{result.attendee_name}</span>
                    </p>
                    {result.ticket_code && (
                      <p>
                        <span className="font-medium text-muted-foreground">Ticket Code:</span>{" "}
                        <span className="font-mono">{result.ticket_code}</span>
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive space-y-2">
                  <div className="flex items-center gap-2 font-bold text-base">
                    {result.reason === "ALREADY_USED" ? (
                      <AlertCircle className="w-6 h-6 text-amber-500 shrink-0" />
                    ) : (
                      <XCircle className="w-6 h-6 text-destructive shrink-0" />
                    )}
                    {result.reason === "ALREADY_USED"
                      ? "Ticket Already Used!"
                      : result.reason === "UNAUTHORIZED"
                      ? "Unauthorized Scanner"
                      : result.reason === "WRONG_EVENT"
                      ? "Ticket Belongs to Another Event"
                      : "Invalid Ticket"}
                  </div>
                  <p className="text-xs text-muted-foreground pl-8">
                    {result.reason === "ALREADY_USED"
                      ? `This ticket was already checked in ${
                          result.scanned_at ? new Date(result.scanned_at).toLocaleString() : ""
                        }.`
                      : result.reason === "UNAUTHORIZED"
                      ? "You do not have permission to check in attendees for this event."
                      : result.reason === "WRONG_EVENT"
                      ? "This ticket was issued for a different event."
                      : "No ticket was found matching this code or ID."}
                  </p>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <Button variant="outline" size="sm" onClick={handleReset} className="rounded-xl flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5" />
                  Scan Next Ticket
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
