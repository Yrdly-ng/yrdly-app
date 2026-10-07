"use client";

import React, { useState, useEffect, useRef, use } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  QrCode,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Camera,
  Upload,
  Keyboard,
  CameraOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";

const FONT = "var(--font-work-sans), sans-serif";
const RALEWAY = "var(--font-raleway), sans-serif";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EventScanTicketPage({ params }: PageProps) {
  const { id: eventId } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [eventTitle, setEventTitle] = useState<string>("");
  const [ticketInput, setTicketInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [mode, setMode] = useState<"camera" | "upload" | "manual">("camera");
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [result, setResult] = useState<{
    success?: boolean;
    reason?: string;
    attendee_name?: string;
    ticket_code?: string;
    scanned_at?: string;
  } | null>(null);

  const scannerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Clean raw QR code output (JSON or direct code)
  const extractCode = (raw: string): string => {
    let clean = raw.trim();
    try {
      const parsed = JSON.parse(clean);
      if (parsed.ticket_code) return parsed.ticket_code;
      if (parsed.ticket_id || parsed.id) return parsed.ticket_id || parsed.id;
    } catch {}
    return clean;
  };

  const processScan = async (rawCode: string) => {
    const code = extractCode(rawCode);
    if (!code || loading) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/tickets/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketInput: code,
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

  // Start Camera QR Scanner
  const startCameraScanner = async () => {
    setCameraError(null);
    try {
      // @ts-ignore
      const { Html5Qrcode } = await import("html5-qrcode");
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
        } catch {}
      }

      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText: string) => {
          stopCameraScanner();
          processScan(decodedText);
        },
        () => {}
      );
      setCameraActive(true);
    } catch (err: any) {
      console.error("Camera start error:", err);
      setCameraError(err.message || "Could not access camera. Please check camera permissions.");
      setCameraActive(false);
    }
  };

  const stopCameraScanner = async () => {
    if (scannerRef.current && cameraActive) {
      try {
        await scannerRef.current.stop();
        scannerRef.current = null;
      } catch {}
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (mode === "camera") {
      startCameraScanner();
    } else {
      stopCameraScanner();
    }
    return () => {
      stopCameraScanner();
    };
  }, [mode]);

  // Handle File Upload QR scan
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // @ts-ignore
      const { Html5Qrcode } = await import("html5-qrcode");
      const html5QrCode = new Html5Qrcode("file-reader");
      const decodedText = await html5QrCode.scanFile(file, true);
      processScan(decodedText);
    } catch (err: any) {
      setResult({
        success: false,
        reason: "No valid ticket QR code found in the uploaded image.",
      });
    }
  };

  const handleManualSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (ticketInput.trim()) {
      processScan(ticketInput);
    }
  };

  const handleReset = () => {
    setTicketInput("");
    setResult(null);
    if (mode === "camera" && !cameraActive) {
      startCameraScanner();
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-6" style={{ fontFamily: FONT }}>
      {/* Hidden container for file decoding */}
      <div id="file-reader" className="hidden" />

      {/* Header */}
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

      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-3 p-1.5 rounded-2xl bg-muted/60 border border-border/40 text-xs font-bold">
        <button
          onClick={() => setMode("camera")}
          className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            mode === "camera"
              ? "bg-card text-foreground shadow-sm border border-border/40"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Camera className="w-4 h-4" /> Live Camera
        </button>
        <button
          onClick={() => setMode("upload")}
          className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            mode === "upload"
              ? "bg-card text-foreground shadow-sm border border-border/40"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Upload className="w-4 h-4" /> Upload QR
        </button>
        <button
          onClick={() => setMode("manual")}
          className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            mode === "manual"
              ? "bg-card text-foreground shadow-sm border border-border/40"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Keyboard className="w-4 h-4" /> Type Code
        </button>
      </div>

      <Card className="rounded-2xl border border-border/40 shadow-sm bg-card overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" />
            {mode === "camera"
              ? "Scan Ticket QR Code"
              : mode === "upload"
              ? "Upload Ticket Image"
              : "Enter Ticket Code or ID"}
          </CardTitle>
          <CardDescription className="text-xs">
            {mode === "camera"
              ? "Point your device camera at the attendee's ticket QR code."
              : mode === "upload"
              ? "Select or upload an image containing a ticket QR code."
              : "Type the attendee ticket code (e.g. TC-89X12A) or ticket UUID."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Mode 1: Live Camera Scanner */}
          {mode === "camera" && (
            <div className="space-y-3">
              <div className="relative w-full overflow-hidden rounded-2xl bg-black border border-border min-h-[280px] flex items-center justify-center">
                <div id="reader" className="w-full" />
                {!cameraActive && !cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/60 p-4 space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-xs font-semibold">Starting camera...</p>
                  </div>
                )}
                {cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-3 bg-card text-foreground">
                    <CameraOff className="w-10 h-10 text-destructive" />
                    <p className="text-xs font-semibold text-destructive">{cameraError}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={startCameraScanner}
                      className="rounded-xl text-xs gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Retry Camera
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mode 2: File Upload Scanner */}
          {mode === "upload" && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border hover:border-primary/50 rounded-2xl p-8 text-center cursor-pointer transition-colors bg-muted/20 hover:bg-muted/40 flex flex-col items-center space-y-2"
            >
              <Upload className="w-8 h-8 text-primary" />
              <p className="text-xs font-bold text-foreground">Click to upload QR code image</p>
              <p className="text-[11px] text-muted-foreground">PNG, JPG, WEBP formats supported</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          )}

          {/* Mode 3: Manual Code Entry */}
          {mode === "manual" && (
            <form onSubmit={handleManualSubmit} className="flex gap-2">
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
          )}

          {/* Scan Result Feedback */}
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
                      <span className="font-bold text-foreground">{result.attendee_name || "Guest"}</span>
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
                      : typeof result.reason === "string"
                      ? result.reason
                      : "No ticket was found matching this code or ID."}
                  </p>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="rounded-xl flex items-center gap-2"
                >
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
