"use client";

import { useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, X, AlertTriangle, FileText } from "lucide-react";
import { DisputeService, DisputeEvidence } from "@/lib/dispute-service";
import { StorageService } from "@/lib/storage-service";

/* ── Design tokens ─────────────────────────────────── */
const BG    = "var(--c-bg)";
const CARD  = "var(--c-card)";
const CARDLO = "var(--c-bg)";
const GREEN = "hsl(var(--primary))";
const RED   = "#E53935";
const MUTED = "var(--c-text-muted)";

const REASONS = [
  { value: "item_different", label: "Item not as described" },
  { value: "item_not_received", label: "Item not received after meetup" },
  { value: "item_damaged", label: "Item is damaged / defective" },
  { value: "seller_unresponsive", label: "Seller is unresponsive" },
  { value: "other", label: "Other (provide details)" },
];

export default function DisputePage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const router    = useRouter();
  const { user }  = useAuth();
  const { toast } = useToast();

  const [selected, setSelected] = useState(0);
  const [detail, setDetail]     = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const fileList = Array.from(files).slice(0, 5 - selectedFiles.length);
    if (fileList.some((file) => file.size > 10 * 1024 * 1024)) {
      toast({ title: "File too large", description: "Each evidence file must be 10 MB or smaller.", variant: "destructive" });
      return;
    }
    setSelectedFiles((prev) => [...prev, ...fileList]);
    setPreviews((prev) => [...prev, ...fileList.map((f) => URL.createObjectURL(f))]);
  };

  const removeImage = (index: number) => {
    URL.revokeObjectURL(previews[index]);
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== index));
    setPreviews((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = useCallback(async () => {
    if (!user) return;
    if (detail.trim().length < 20) {
      toast({ title: "Add more detail", description: "Please describe what happened in at least 20 characters.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const uploadedPaths: string[] = [];
      for (const file of selectedFiles) {
        const { path, error } = await StorageService.uploadDisputeEvidence(transactionId, user.id, file);
        if (error || !path) throw error || new Error("Evidence upload failed");
        uploadedPaths.push(path);
      }

      const reason = REASONS[selected].value;
      const evidence: DisputeEvidence = {
        description: detail.trim(),
        photos: uploadedPaths,
      };
      const opened = await DisputeService.openDispute(transactionId, user.id, reason, evidence);
      toast({
        title: opened.providerSubmissionStatus === 'needs_reconciliation' ? "Dispute filed; payment provider sync needs review" : "Dispute submitted",
        description: opened.providerSubmissionStatus === 'needs_reconciliation'
          ? "Your dispute is saved locally. Support will reconcile the Payluk submission before settlement."
          : "Our team will review it within 24–48 hours.",
        variant: opened.providerSubmissionStatus === 'needs_reconciliation' ? 'destructive' : 'default',
      });
      router.push(`/transactions/${transactionId}`);
    } catch (err) {
      console.error("Dispute submission error:", err);
      toast({ title: "Error", description: "Could not submit dispute. Try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, transactionId, toast, router, selected, detail, selectedFiles]);

  return (
    <div className="bg-background text-on-surface font-body min-h-dvh pb-10">
      {/* Top Navigation Anchor */}
      <header className="fixed top-0 w-full z-50 bg-[var(--c-bg)]/80 backdrop-blur-xl flex items-center px-6 h-16 w-full">
        <div className="flex items-center gap-4 w-full">
          <button onClick={() => router.back()} className="active:scale-95 transition-transform hover:opacity-80 transition-opacity">
            <ArrowLeft className="text-primary w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <h1 className="font-jersey25 text-2xl tracking-tight text-on-surface" style={{ fontFamily: "var(--font-jersey25)" }}>Raise a Dispute</h1>
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
                      ? "bg-surface-container border-primary ring-1 ring-primary" 
                      : "bg-surface-container-low hover:bg-surface-container border-transparent"
                  }`}
                >
                  <span className={`font-raleway text-sm ${active ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`} style={{ fontFamily: "Raleway, sans-serif" }}>
                    {r.label}
                  </span>
                  <input
                    type="radio"
                    name="dispute_reason"
                    checked={active}
                    onChange={() => setSelected(i)}
                    className={`w-5 h-5 border-2 bg-transparent focus:ring-0 ${
                      active 
                        ? "border-primary text-primary checked:bg-primary" 
                        : "border-outline-variant text-primary"
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
            <span className="text-[0.625rem] text-outline">{detail.length} / 2000</span>
          </div>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value.slice(0, 2000))}
            className="w-full h-32 bg-[#1B2B3A] border-none focus:ring-1 focus:ring-primary rounded-[11px] p-4 font-raleway text-sm text-on-surface placeholder:italic placeholder:font-light placeholder:text-outline/50 transition-all resize-none"
            style={{ fontFamily: "Raleway, sans-serif" }}
            placeholder="Tell us what happened..."
          ></textarea>
        </section>

        {/* Evidence Upload */}
        <section className="space-y-4">
          <label className="text-on-surface-variant font-raleway text-xs uppercase tracking-widest font-bold px-1" style={{ fontFamily: "Raleway, sans-serif" }}>Evidence</label>
          <button 
            onClick={() => fileRef.current?.click()}
            className="w-full aspect-[4/1] bg-surface-container border-2 border-dashed border-primary rounded-[11px] flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-surface-container-high transition-colors"
          >
            <Camera className="text-primary w-6 h-6" />
            <p className="font-raleway text-[0.75rem] text-[#bfcab9]" style={{ fontFamily: "Raleway, sans-serif" }}>Upload photos or screenshots</p>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" multiple className="hidden" onChange={handleImageAdd} />

          {/* Thumbnail Grid */}
          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {previews.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-[11px] overflow-hidden group">
                  {selectedFiles[i]?.type === 'application/pdf' ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-surface-container text-primary"><FileText className="w-8 h-8" /><span className="text-xs">PDF evidence</span></div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="Evidence" className="w-full h-full object-cover" />
                  )}
                  <button 
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center text-primary-foreground"
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
            disabled={loading || detail.trim().length < 20}
            className="w-full py-4 bg-[#E53935] text-primary-foreground font-raleway font-bold rounded-full shadow-lg shadow-[#E53935]/20 active:scale-95 transition-all"
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
