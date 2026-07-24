"use client";

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { TransactionStatusService } from "@/lib/transaction-status-service";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CheckCircle, AlertTriangle, Info } from "lucide-react";

/* ── Design tokens ─────────────────────────────────── */
const BG      = "var(--c-bg)";
const CARD    = "var(--c-card)";
const GREEN   = "hsl(var(--primary))";
const GREEN_L = "#82DB7E";
const MUTED   = "var(--c-text-muted)";
const RED     = "#E53935";

export default function ConfirmReceiptPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const router    = useRouter();
  const { user }  = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [shippedAt, setShippedAt] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState({ hours: 48, minutes: 0, seconds: 0 });
  const [strokeOffset, setStrokeOffset] = useState(140);

  useEffect(() => {
    async function fetchTx() {
      const { data } = await supabase.from('escrow_transactions').select('shipped_at').eq('id', transactionId).single();
      if (data?.shipped_at) setShippedAt(data.shipped_at);
    }
    fetchTx();
  }, [transactionId]);

  useEffect(() => {
    if (!shippedAt) return;
    
    const interval = setInterval(() => {
      const shippedTime = new Date(shippedAt).getTime();
      const deadline = shippedTime + 48 * 60 * 60 * 1000;
      const now = Date.now();
      const diff = deadline - now;
      
      if (diff <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
        setStrokeOffset(565.48); // Full circle stroke hidden
        clearInterval(interval);
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeLeft({ hours, minutes, seconds });
      
      // Update SVG stroke (0 = full circle, 565.48 = empty)
      // Percentage of time elapsed: 0 to 1
      const totalTime = 48 * 60 * 60 * 1000;
      const elapsed = totalTime - diff;
      const percentage = elapsed / totalTime;
      // dasharray is 565.48. dashoffset goes from 0 (full) to 565.48 (empty).
      // At start (0% elapsed), it's full (0 offset). At end (100% elapsed), it's empty (565.48).
      setStrokeOffset(percentage * 565.48);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [shippedAt]);

  const pad = (n: number) => n.toString().padStart(2, '0');
  const timerDisplay = `${pad(timeLeft.hours)}:${pad(timeLeft.minutes)}:${pad(timeLeft.seconds)}`;


  const handleConfirm = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Step 1: Confirm delivery received
      await TransactionStatusService.confirmDelivered(transactionId, user.id);
      // Step 2: Immediately complete the transaction and release funds
      await TransactionStatusService.completeTransaction(transactionId);
      toast({ title: "Receipt confirmed!", description: "Funds have been released to the seller." });
      router.push(`/transactions/${transactionId}`);
    } catch {
      toast({ title: "Error", description: "Could not confirm receipt. Try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, transactionId, toast, router]);

  return (
    <div className="bg-background text-on-background font-body selection:bg-primary selection:text-on-primary min-h-dvh">
      {/* Visual Polish: Background Ambient Glow */}
      <div className="fixed -bottom-24 -left-24 w-96 h-96 bg-primary/5 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed -top-24 -right-24 w-96 h-96 bg-secondary/5 rounded-full blur-[120px] pointer-events-none"></div>

      {/* Top Navigation Anchor */}
      <header className="fixed top-0 w-full z-50 bg-[var(--c-bg)]/80 backdrop-blur-xl flex items-center px-6 h-16 w-full">
        <div className="flex items-center gap-4 w-full max-w-2xl mx-auto">
          <button onClick={() => router.back()} className="active:scale-95 transition-transform hover:opacity-80 flex items-center justify-center">
            <ArrowLeft className="w-6 h-6 text-primary" />
          </button>
          <h1 className="font-jersey25 text-2xl tracking-tight text-on-background">Did You Receive It?</h1>
        </div>
      </header>

      <main className="pt-24 pb-12 px-6 max-w-2xl mx-auto flex flex-col items-center">
        {/* Countdown Section */}
        <div className="relative flex flex-col items-center mb-10">
          <div className="relative w-48 h-48 flex items-center justify-center">
            <svg className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="96" cy="96" r="90" fill="none" className="stroke-[#1d2025] stroke-[6px]"></circle>
              <circle cx="96" cy="96" r="90" fill="none" className="stroke-[#82db7e] stroke-[6px]" strokeLinecap="round" strokeDasharray="565.48" strokeDashoffset={strokeOffset}></circle>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
              <span className="font-brand text-[2.5rem] text-primary leading-none" style={{ fontFamily: "Jersey 25, cursive" }}>{timerDisplay}</span>
            </div>
          </div>
          <p className="font-editorial text-[0.6875rem] text-on-surface-variant mt-4 uppercase tracking-widest text-center">
            Remaining to confirm or auto-release
          </p>
        </div>

        {/* Action Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full mb-12">
          {/* All Good Card */}
          <button 
            onClick={handleConfirm}
            disabled={loading}
            className="group flex flex-col items-center p-6 bg-surface-container rounded-lg border-2 border-transparent hover:border-tertiary-container transition-all text-center h-full active:scale-[0.98]"
          >
            <div className="w-12 h-12 rounded-full bg-tertiary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <CheckCircle className="text-tertiary w-7 h-7" />
            </div>
            <h4 className="font-editorial font-bold text-sm text-on-surface mb-1">All Good!</h4>
            <p className="font-editorial text-xs text-on-surface-variant mb-6">Item received in good condition</p>
            <div className="mt-auto w-full py-2.5 px-6 bg-tertiary-container text-primary-foreground rounded-full font-editorial text-sm font-bold shadow-lg shadow-tertiary-container/20">
              {loading ? "Confirming..." : "Confirm Receipt"}
            </div>
          </button>

          {/* Problem Card */}
          <button 
            onClick={() => router.push(`/transactions/${transactionId}/dispute`)}
            className="group flex flex-col items-center p-6 bg-surface-container rounded-lg border-2 border-transparent hover:border-error transition-all text-center h-full active:scale-[0.98]"
          >
            <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <AlertTriangle className="text-error w-7 h-7" />
            </div>
            <h4 className="font-editorial font-bold text-sm text-on-surface mb-1">There&apos;s an issue</h4>
            <p className="font-editorial text-xs text-on-surface-variant mb-6">Not as described / missing items</p>
            <div className="mt-auto w-full py-2.5 px-6 border border-error text-error rounded-full font-editorial text-sm font-bold hover:bg-error/5 transition-colors">
              Raise Dispute
            </div>
          </button>
        </div>

        {/* Fine Print */}
        <div className="mt-12 w-full text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-surface-container-high/30 rounded-full border border-outline-variant/10">
            <Info className="w-4 h-4 text-on-surface-variant" />
            <p className="font-editorial text-[0.625rem] text-on-surface-variant uppercase tracking-wider">
              If you take no action in 48h, funds will be auto-released to the seller.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
