"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { TransactionStatusService } from "@/lib/transaction-status-service";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ShieldCheck, HeadphonesIcon } from "lucide-react";

/* ── Design tokens ─────────────────────────────────── */
const BG    = "var(--c-bg)";
const CARD  = "var(--c-card)";
const CARDHIGH = "var(--c-card2)";
const GREEN = "#388E3C";
const GREEN_L = "#82DB7E";
const MUTED = "var(--c-text-muted)";
const DIM   = "var(--c-text-muted)";

const CHECKLIST = [
  "Item matches the listing description",
  "Item is in the agreed condition",
  "I've arranged the handover location",
];

export default function MarkAsSentPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const router    = useRouter();
  const { user }  = useAuth();
  const { toast } = useToast();

  const [checked, setChecked]   = useState<boolean[]>(CHECKLIST.map(() => false));
  const [loading, setLoading]   = useState(false);

  const allChecked = checked.every(Boolean);

  const toggle = (i: number) => {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  };

  const handleConfirm = useCallback(async () => {
    if (!user || !allChecked) return;
    setLoading(true);
    try {
      await TransactionStatusService.confirmShipped(transactionId, user.id);
      toast({ title: "Item marked as sent!", description: "The buyer has been notified." });
      router.push(`/transactions/${transactionId}`);
    } catch {
      toast({ title: "Error", description: "Could not update status. Try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, allChecked, transactionId, toast, router]);

  return (
    <div className="bg-background text-on-background font-body antialiased min-h-dvh pb-10">
      {/* TopAppBar Component */}
      <header className="fixed top-0 w-full z-50 bg-[#15181D]/80 backdrop-blur-xl flex items-center px-6 h-16 w-full">
        <div className="flex items-center gap-4 w-full">
          <button onClick={() => router.back()} className="active:scale-95 transition-transform">
            <ArrowLeft className="w-6 h-6 text-on-surface" />
          </button>
          <h1 className="text-on-background font-cursive text-[1.375rem] leading-none" style={{ fontFamily: "Pacifico, cursive" }}>Ready to Hand Over?</h1>
        </div>
      </header>

      <main className="pt-24 px-6 max-w-lg mx-auto space-y-8">
        {/* Payout Info */}
        <section className="bg-surface-container rounded-[11px] overflow-hidden">
          <div className="px-4 py-6 text-center border-b border-outline-variant/10">
            <p className="text-primary text-2xl font-display font-bold tracking-tight mb-1" style={{ fontFamily: "Raleway, sans-serif" }}>Funds <span className="text-sm font-medium">will be released to you</span></p>
            <p className="text-[#bfcab9] font-display text-[0.6875rem] leading-normal opacity-80" style={{ fontFamily: "Raleway, sans-serif" }}>After buyer confirms receipt (or 48h auto-release)</p>
          </div>
        </section>

        {/* Checklist Card */}
        <section className="bg-surface-container rounded-[11px] p-6 space-y-5">
          {CHECKLIST.map((label, i) => {
            const done = checked[i];
            return (
              <div 
                key={i} 
                onClick={() => toggle(i)}
                className="flex items-center gap-4 group cursor-pointer"
              >
                <div className={`w-7 h-7 rounded-full border-2 ${done ? 'border-primary' : 'border-outline-variant'} flex items-center justify-center shrink-0`}>
                  {done ? (
                    <ShieldCheck className="w-4 h-4 text-primary" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-outline-variant opacity-0 group-hover:opacity-40 transition-opacity"></div>
                  )}
                </div>
                <p className="text-on-surface font-display text-[0.9375rem] font-medium" style={{ fontFamily: "Raleway, sans-serif" }}>{label}</p>
              </div>
            );
          })}
        </section>

        {/* CTA Section */}
        <section className="space-y-4 pt-4">
          <button
            onClick={handleConfirm}
            disabled={!allChecked || loading}
            className={`w-full py-5 px-8 rounded-full font-display font-bold text-base transition-all ${
              allChecked && !loading
                ? "bg-[#388E3C] text-white shadow-[0_0_20px_rgba(56,142,60,0.4)] active:scale-95"
                : "bg-surface-container-high text-outline cursor-not-allowed opacity-80"
            }`}
            style={{ fontFamily: "Raleway, sans-serif" }}
          >
            {loading ? "Confirming..." : "Confirm Item Sent / Ready"}
          </button>
          <p className="text-center text-on-surface-variant text-[0.75rem] leading-relaxed px-8">
            Once confirmed, the 48h buyer confirmation window begins.
          </p>
        </section>

        {/* Contextual Information */}
        <div className="grid grid-cols-2 gap-4 mt-12">
          <div className="bg-surface-container-low p-4 rounded-xl border-l-2 border-tertiary">
            <ShieldCheck className="text-tertiary mb-2 w-6 h-6" />
            <h3 className="text-on-surface font-bold text-sm">Escrow Secure</h3>
            <p className="text-on-surface-variant text-[0.6875rem] mt-1">Funds are held safely by the platform until handover.</p>
          </div>
          <div className="bg-surface-container-low p-4 rounded-xl border-l-2 border-secondary">
            <HeadphonesIcon className="text-secondary mb-2 w-6 h-6" />
            <h3 className="text-on-surface font-bold text-sm">Need Help?</h3>
            <p className="text-on-surface-variant text-[0.6875rem] mt-1">Contact support if the buyer is a no-show.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
