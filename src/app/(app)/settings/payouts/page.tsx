"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wallet, DollarSign, Clock, ArrowUpRight, CheckCircle2, Building, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-jersey25)";

export default function PayoutsDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [availableBalance, setAvailableBalance] = useState(0);
  const [lifetimeEarned, setLifetimeEarned] = useState(0);
  const [pendingEscrow, setPendingEscrow] = useState(0);
  const [bankInfo, setBankInfo] = useState<any>(null);
  const [payoutHistory, setPayoutHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);

  const fetchPayoutData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      // Fetch escrow transactions
      const { data: escrows } = await supabase
        .from("escrow_transactions")
        .select("seller_amount, status")
        .eq("seller_id", user.id);

      // Fetch payout requests history
      const { data: payouts } = await supabase
        .from("payout_requests")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      // Fetch seller bank setup info
      try {
        const res = await fetch(`/api/seller/setup-account?userId=${user.id}`);
        if (res.ok) {
          const bankData = await res.json();
          setBankInfo(bankData);
        }
      } catch (e) {
        console.error("Bank info error:", e);
      }

      // Calculate totals
      let totalCompleted = 0;
      let totalPending = 0;

      (escrows || []).forEach((item: any) => {
        const amt = Number(item.seller_amount || 0);
        if (item.status === "completed") {
          totalCompleted += amt;
        } else if (["pending", "paid", "shipped", "delivered"].includes(item.status)) {
          totalPending += amt;
        }
      });

      const totalWithdrawn = (payouts || []).reduce((acc: number, cur: any) => acc + Number(cur.amount || 0), 0);
      const available = Math.max(0, totalCompleted - totalWithdrawn);

      setAvailableBalance(available);
      setLifetimeEarned(totalCompleted);
      setPendingEscrow(totalPending);
      setPayoutHistory(payouts || []);
    } catch (err) {
      console.error("Error fetching payout data:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPayoutData();
  }, [fetchPayoutData]);

  const handleWithdraw = async () => {
    if (availableBalance <= 0) {
      toast({ title: "Insufficient balance to withdraw", variant: "destructive" });
      return;
    }

    setWithdrawing(true);
    try {
      const res = await fetch("/api/seller/payouts/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: availableBalance }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Withdrawal failed");
      }

      router.push(`/settings/withdraw-success?amount=${availableBalance}`);
    } catch (err: any) {
      toast({ title: err.message || "Withdrawal request failed", variant: "destructive" });
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-xs font-bold text-muted-foreground uppercase tracking-wider" style={{ fontFamily: FONT }}>
          Loading balance & payout history...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-card transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
          Payout Dashboard
        </h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Main Balance Card */}
        <div
          className="p-6 rounded-3xl border relative overflow-hidden space-y-6 shadow-xl"
          style={{
            background: "linear-gradient(135deg, rgba(56,142,60,0.2) 0%, rgba(130,219,126,0.05) 100%)",
            borderColor: "rgba(130,219,126,0.3)",
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-1.5" style={{ fontFamily: FONT }}>
              <Wallet className="w-4 h-4" /> Available Balance
            </span>
            {bankInfo && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-primary/20 text-primary">
                <ShieldCheck className="w-3.5 h-3.5" /> Bank Linked
              </span>
            )}
          </div>

          <div>
            <div className="text-4xl sm:text-5xl font-extrabold text-foreground tracking-tight" style={{ fontFamily: RALEWAY }}>
              ₦{availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="mt-1 text-xs text-muted-foreground" style={{ fontFamily: FONT }}>
              Ready for immediate transfer to your linked bank account.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleWithdraw}
              disabled={withdrawing || availableBalance <= 0}
              className="flex-1 py-3.5 px-6 rounded-2xl bg-primary text-primary-foreground font-bold text-sm shadow-lg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              style={{ fontFamily: FONT }}
            >
              <ArrowUpRight className="w-4 h-4" />
              {withdrawing ? "Processing..." : "Withdraw Funds"}
            </button>

            <button
              onClick={() => router.push("/profile/payout-settings")}
              className="py-3.5 px-4 rounded-2xl border border-border/60 bg-card hover:bg-card/80 text-foreground font-bold text-sm transition-all"
              style={{ fontFamily: FONT }}
            >
              Bank Settings
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-card border border-border/40 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <DollarSign className="w-3.5 h-3.5 text-primary" /> Lifetime Earned
            </div>
            <p className="text-xl font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
              ₦{lifetimeEarned.toLocaleString()}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-card border border-border/40 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Clock className="w-3.5 h-3.5 text-amber-500" /> Pending Escrow
            </div>
            <p className="text-xl font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
              ₦{pendingEscrow.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Bank Account Overview */}
        {bankInfo?.account_number && (
          <div className="p-4 rounded-2xl bg-card border border-border/40 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Building className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
                  {bankInfo.bank_name || "Linked Bank"}
                </p>
                <p className="text-xs text-muted-foreground" style={{ fontFamily: FONT }}>
                  {bankInfo.account_number} • {bankInfo.account_name}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Payout Request History */}
        <div className="space-y-3">
          <h2 className="text-base font-bold text-foreground px-1" style={{ fontFamily: RALEWAY }}>
            Withdrawal History
          </h2>

          {payoutHistory.length === 0 ? (
            <div className="p-8 text-center bg-card rounded-2xl border border-border/40 text-muted-foreground space-y-1">
              <p className="text-sm font-medium" style={{ fontFamily: FONT }}>No withdrawals requested yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {payoutHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-2xl bg-card border border-border/40 flex items-center justify-between"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
                      ₦{Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground" style={{ fontFamily: FONT }}>
                      {new Date(item.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </p>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold capitalize ${
                      item.status === "completed" || item.status === "approved"
                        ? "bg-green-500/20 text-green-400"
                        : item.status === "rejected"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-amber-500/20 text-amber-400"
                    }`}
                    style={{ fontFamily: FONT }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
