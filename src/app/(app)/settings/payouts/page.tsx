"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Eye,
  EyeOff,
  Building2,
  ArrowUpDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";

type PayoutStatus = "pending" | "processing" | "completed" | "failed";

interface PayoutRequest {
  id: string;
  amount: number;
  status: PayoutStatus;
  requested_at: string;
  processed_at: string | null;
  bank_name?: string;
  account_number?: string;
}

const STATUS_COLOR: Record<string, string> = {
  completed: "#82DB7E",
  processing: "#64B5F6",
  pending: "#FFB648",
  failed: "#ef4444",
};

export default function PayoutsDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [balance, setBalance] = useState(0);
  const [lifetimeEarned, setLifetimeEarned] = useState(0);
  const [pendingEscrow, setPendingEscrow] = useState(0);

  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [bankInfo, setBankInfo] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      const [txRes, payoutRes, bankRes, balRes] = await Promise.all([
        supabase
          .from("escrow_transactions")
          .select("seller_amount, status")
          .eq("seller_id", user.id),
        supabase
          .from("payout_requests")
          .select("id, amount, status, requested_at, processed_at")
          .eq("seller_id", user.id)
          .order("requested_at", { ascending: false }),
        fetch(`/api/seller/setup-account?userId=${user.id}`).then((r) =>
          r.ok ? r.json() : { account: null }
        ).catch(() => ({ account: null })),
        fetch("/api/seller/payouts/balance").then((r) =>
          r.ok ? r.json() : null
        ).catch(() => null),
      ]);

      const txs = txRes.data ?? [];
      const pyts = payoutRes.data ?? [];

      const earned = txs
        .filter((t: any) => t.status === "completed")
        .reduce((sum: number, t: any) => sum + (Number(t.seller_amount) || 0), 0);
      const pendingE = txs
        .filter((t: any) => ["pending", "paid", "shipped", "delivered"].includes(t.status))
        .reduce((sum: number, t: any) => sum + (Number(t.seller_amount) || 0), 0);

      const paidOut = pyts
        .filter((p: any) => ["pending", "processing", "completed"].includes(p.status))
        .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);

      const fallbackBalance = Math.max(0, earned - paidOut);
      const serverAvailable = balRes && typeof balRes.availableBalance === "number" ? balRes.availableBalance : fallbackBalance;

      setLifetimeEarned(earned);
      setPendingEscrow(pendingE);
      setBalance(serverAvailable);
      setPayouts(pyts as PayoutRequest[]);

      if (bankRes.account) {
        setBankInfo(bankRes.account);
      } else {
        setBankInfo(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRequestPayout = async () => {
    if (balance <= 0) {
      toast({ title: "No balance", description: "You have no available balance to withdraw." });
      return;
    }
    if (!bankInfo) {
      toast({ title: "Bank Required", description: "Please add a bank account first." });
      return;
    }

    setRequesting(true);
    try {
      const res = await fetch("/api/seller/payouts/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: balance }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Withdrawal failed");
      }

      router.push(`/settings/withdraw-success?amount=${balance}`);
    } catch (err: any) {
      toast({ title: "Withdrawal failed", description: err.message, variant: "destructive" });
    } finally {
      setRequesting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--yrdly-dark)] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#82DB7E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--yrdly-dark)] text-[var(--yrdly-text)] pb-20 font-yrdly-body">
      {/* Header */}
      <header className="lg:hidden sticky top-0 z-30 bg-[var(--yrdly-dark)]/80 backdrop-blur-md px-5 py-3 border-b border-[var(--yrdly-glass-border)]">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/settings")}
            className="w-8 h-8 rounded-[11px] bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] flex items-center justify-center text-[var(--yrdly-text)] hover:opacity-80 transition-opacity"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-[18px] font-bold text-[var(--yrdly-text)] font-yrdly-display">
            Payouts
          </h1>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-5 py-5 space-y-6">
        {/* Balance Hero Card */}
        <div
          className="rounded-[28px] p-[22px] space-y-4"
          style={{
            backgroundColor: "rgba(130,219,126,0.06)",
            border: "1px solid rgba(130,219,126,0.2)",
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium tracking-[1px] text-[var(--yrdly-label)] uppercase font-yrdly-body">
              AVAILABLE BALANCE
            </span>
            <button
              onClick={() => setBalanceVisible(!balanceVisible)}
              className="text-[var(--yrdly-label)] hover:text-[var(--yrdly-text)] transition-colors p-1"
            >
              {balanceVisible ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
            </button>
          </div>

          <div className="text-[38px] font-bold text-[var(--yrdly-text)] tracking-[-1px] leading-tight font-yrdly-display">
            {balanceVisible
              ? `₦${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
              : "₦•••,•••.••"}
          </div>

          {/* Stats Row */}
          <div className="flex items-center py-2 border-y border-[var(--yrdly-glass-border)]">
            <div className="flex-1">
              <p className="text-[11px] text-[var(--yrdly-label)] mb-1 font-yrdly-body">
                Pending Escrow
              </p>
              <p className="text-[16px] font-bold font-yrdly-display" style={{ color: "#FFB648" }}>
                {balanceVisible ? `₦${pendingEscrow.toLocaleString()}` : "₦•••,•••"}
              </p>
            </div>
            <div className="w-[1px] h-9 bg-[var(--yrdly-glass-border)] mx-4" />
            <div className="flex-1">
              <p className="text-[11px] text-[var(--yrdly-label)] mb-1 font-yrdly-body">
                Lifetime Earned
              </p>
              <p className="text-[16px] font-bold font-yrdly-display" style={{ color: "#82DB7E" }}>
                {balanceVisible ? `₦${lifetimeEarned.toLocaleString()}` : "₦•••,•••"}
              </p>
            </div>
          </div>

          {/* Bank Preview */}
          <button
            onClick={() => router.push("/settings/payout-settings")}
            className="w-full flex items-center gap-3 p-3.5 rounded-[16px] bg-[var(--yrdly-surface)] border border-white/5 hover:border-white/10 transition-all text-left"
          >
            <div
              className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: "rgba(130,219,126,0.08)" }}
            >
              <Building2 className="w-4 h-4 text-[#82DB7E]" />
            </div>
            {bankInfo ? (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--yrdly-text)] truncate font-yrdly-body">
                    {bankInfo.bankName || bankInfo.bank_name || "Bank"} · ****
                    {(bankInfo.accountNumber || bankInfo.account_number || "").slice(-4)}
                  </p>
                  <p className="text-[11px] text-[var(--yrdly-label)] truncate font-yrdly-body">
                    {bankInfo.accountName || bankInfo.account_name}
                  </p>
                </div>
                <div
                  className="px-2 py-0.5 rounded-[6px] text-[10px] font-bold font-yrdly-display tracking-wider uppercase"
                  style={{
                    backgroundColor: "rgba(130,219,126,0.1)",
                    border: "1px solid rgba(130,219,126,0.2)",
                    color: "#82DB7E",
                  }}
                >
                  {bankInfo.isVerified !== false ? "VERIFIED" : "PENDING"}
                </div>
              </>
            ) : (
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--yrdly-text)] font-yrdly-body">
                  No Bank Account
                </p>
                <p className="text-[11px] text-[var(--yrdly-label)] font-yrdly-body">
                  Tap to add one
                </p>
              </div>
            )}
          </button>

          {/* Withdraw Button */}
          <button
            onClick={handleRequestPayout}
            disabled={balance <= 0 || requesting || !bankInfo}
            className="w-full py-3.5 rounded-[16px] bg-[#82DB7E] text-black font-bold text-[16px] font-yrdly-display hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center"
          >
            {requesting ? (
              <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : (
              "Withdraw Funds"
            )}
          </button>
        </div>

        {/* Payout History Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-[1px] text-[var(--yrdly-label)] font-yrdly-body">
              PAYOUT HISTORY
            </h2>
            <button
              onClick={() => router.push("/settings/payout-settings")}
              className="text-[12px] text-[#82DB7E] hover:underline font-yrdly-body"
            >
              Change Bank
            </button>
          </div>

          <div className="rounded-[24px] bg-[var(--yrdly-surface-alt)] border border-[var(--yrdly-glass-border)] overflow-hidden">
            {payouts.length === 0 ? (
              <div className="py-10 text-center space-y-1">
                <p className="text-[16px] font-bold text-[var(--yrdly-text)] font-yrdly-display">
                  No payouts
                </p>
                <p className="text-[13px] text-[var(--yrdly-label)] font-yrdly-body">
                  Nothing here yet.
                </p>
              </div>
            ) : (
              <div>
                {payouts.map((item, index) => {
                  const col = STATUS_COLOR[item.status] || STATUS_COLOR.pending;
                  const dateStr = new Date(item.requested_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  });

                  return (
                    <div key={item.id}>
                      <div className="flex items-center gap-3 px-5 py-4">
                        <div
                          className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${col}14` }}
                        >
                          <ArrowUpDown className="w-5 h-5" style={{ color: col }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold text-[var(--yrdly-text)] truncate font-yrdly-body">
                            {item.bank_name || 'Bank'} · ****{item.account_number ? item.account_number.slice(-4) : '****'}
                          </p>
                          <p className="text-[11px] text-[var(--yrdly-label)] truncate font-yrdly-body">
                            {dateStr} · {item.id.slice(0, 8).toUpperCase()}
                          </p>
                        </div>
                        <div className="text-right space-y-0.5">
                          <p className="text-[15px] font-bold text-[var(--yrdly-text)] font-yrdly-display">
                            ₦{Number(item.amount).toLocaleString()}
                          </p>
                          <p
                            className="text-[10px] font-bold tracking-wider uppercase font-yrdly-display"
                            style={{ color: col }}
                          >
                            {item.status}
                          </p>
                        </div>
                      </div>
                      {index < payouts.length - 1 && (
                        <div className="h-[1px] bg-[var(--yrdly-glass-border)] ml-[70px]" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

