"use client";

import { useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, X, AlertTriangle } from "lucide-react";
import { DisputeService, DisputeEvidence } from "@/lib/dispute-service";

/* ── Design tokens ─────────────────────────────────── */
const BG    = "var(--c-bg)";
const CARD  = "var(--c-card)";
const CARDLO = "var(--c-bg)";
const GREEN = "#388E3C";
const RED   = "#E53935";
const MUTED = "var(--c-text-muted)";

const REASONS = [
  "Item not as described",
  "Item not received after meetup",
  "Item is damaged / defective",
  "Seller is unresponsive",
  "Other (provide details)",
];

export default function DisputePage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const router    = useRouter();
  const { user }  = useAuth();
  const { toast } = useToast();

  const [selected, setSelected] = useState(0);
  const [detail, setDetail]     = useState("");
  const [images, setImages]     = useState<string[]>([]);
  const [loading, setLoading]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => {
      const url = URL.createObjectURL(f);
      setImages((prev) => [...prev.slice(0, 4), url]);
    });
  };

  const handleSubmit = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const reason = `${REASONS[selected]}${detail ? `: ${detail}` : ""}`;
      const evidence: DisputeEvidence = {
        description: reason,
        photos: images,
      };
      await DisputeService.openDispute(transactionId, user.id, reason, evidence);
      toast({ title: "Dispute submitted", description: "Our team will review it within 24–48 hours." });
      router.push(`/transactions/${transactionId}`);
    } catch {
      toast({ title: "Error", description: "Could not submit dispute. Try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, transactionId, toast, router, selected, detail]);

  return (
    <div className="bg-background text-on-surface font-body min-h-dvh pb-10">
      {/* Top Navigation Anchor */}
      <header className="fixed top-0 w-full z-50 bg-[var(--c-bg)]/80 backdrop-blur-xl flex items-center px-6 h-16 w-full">
        <div className="flex items-center gap-4 w-full">
          <button onClick={() => router.back()} className="active:scale-95 transition-transform hover:opacity-80 transition-opacity">
            <ArrowLeft className="text-[#388E3C] w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <h1 className="font-pacifico text-2xl tracking-tight text-on-surface" style={{ fontFamily: "Pacifico, cursive" }}>Raise a Dispute</h1>
            <span className="bg-[#E53935] w-2 h-2 rounded-full ring-4 ring-[#E53935]/20 animate-pulse"></span>
          </div>
        </div>
      </header>

      <main className="pt-20 pb-10 px-6 max-w-2xl mx-auto space-y-8">
        {/* Warning Banner */}
        <section className="bg-[#E53935]/10 border border-[#E53935] rounded-[11px] p-4 flex gap-3 items-start">
          <AlertTriangle className="text-[#E53935] mt-0.5 w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-raleway text-on-surface leading-snug" style={{ fontFamily: "Raleway, sans-serif" }}>Your funds will remain on hold while our team reviews this.</p>
        </section>

        {/* Reason Selection */}
        <section className="space-y-4">
          <h2 className="text-on-surface-variant font-raleway text-xs uppercase tracking-widest font-bold px-1" style={{ fontFamily: "Raleway, sans-serif" }}>Select a Reason</h2>
          <div className="space-y-2">
            {REASONS.map((r, i) => {
              const active = i === selected;
              return (
                <label
                  key={i}
                  className={`flex items-center justify-between p-4 rounded-[11px] border-l-4 cursor-pointer group transition-all ${
                    active 
                      ? "bg-surface-container border-[#388E3C] ring-1 ring-[#388E3C]" 
                      : "bg-surface-container-low hover:bg-surface-container border-transparent"
                  }`}
                >
                  <span className={`font-raleway text-sm ${active ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`} style={{ fontFamily: "Raleway, sans-serif" }}>
                    {r}
                  </span>
                  <input
                    type="radio"
                    name="dispute_reason"
                    checked={active}
                    onChange={() => setSelected(i)}
                    className={`w-5 h-5 border-2 bg-transparent focus:ring-0 ${
                      active 
                        ? "border-[#388E3C] text-[#388E3C] checked:bg-[#388E3C]" 
                        : "border-outline-variant text-[#388E3C]"
                    }`}
                  />
                </label>
              );
            })}
          </div>
        </section>

        {/* Details Textarea */}
        <section className="space-y-2">
          <div className="flex justify-between items-center px-1">
            <label className="text-on-surface-variant font-raleway text-xs uppercase tracking-widest font-bold" style={{ fontFamily: "Raleway, sans-serif" }}>Details</label>
            <span className="text-[0.625rem] text-outline">{detail.length} / 150</span>
          </div>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value.slice(0, 150))}
            className="w-full h-32 bg-[#1B2B3A] border-none focus:ring-1 focus:ring-[#388E3C] rounded-[11px] p-4 font-raleway text-sm text-on-surface placeholder:italic placeholder:font-light placeholder:text-outline/50 transition-all resize-none"
            style={{ fontFamily: "Raleway, sans-serif" }}
            placeholder="Tell us what happened..."
          ></textarea>
        </section>

        {/* Evidence Upload */}
        <section className="space-y-4">
          <label className="text-on-surface-variant font-raleway text-xs uppercase tracking-widest font-bold px-1" style={{ fontFamily: "Raleway, sans-serif" }}>Evidence</label>
          <button 
            onClick={() => fileRef.current?.click()}
            className="w-full aspect-[4/1] bg-surface-container border-2 border-dashed border-[#388E3C] rounded-[11px] flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-surface-container-high transition-colors"
          >
            <Camera className="text-[#388E3C] w-6 h-6" />
            <p className="font-raleway text-[0.75rem] text-[#bfcab9]" style={{ fontFamily: "Raleway, sans-serif" }}>Upload photos or screenshots</p>
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageAdd} />

          {/* Thumbnail Grid */}
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {images.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-[11px] overflow-hidden group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="Evidence" className="w-full h-full object-cover" />
                  <button 
                    onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* CTA Section */}
        <footer className="pt-6 space-y-4">
          <button 
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-4 bg-[#E53935] text-white font-raleway font-bold rounded-full shadow-lg shadow-[#E53935]/20 active:scale-95 transition-all"
            style={{ fontFamily: "Raleway, sans-serif" }}
          >
            {loading ? "Submitting..." : "Submit Dispute"}
          </button>
          <div className="flex items-center justify-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0 text-on-surface-variant">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={1.5} />
              <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
            <p className="font-raleway text-[0.6875rem] text-[#bfcab9] text-center" style={{ fontFamily: "Raleway, sans-serif" }}>Our team reviews disputes within 24-48 hours</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
