"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Building, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";

const FONT = "var(--yrdly-font-body)";
const RALEWAY = "var(--yrdly-font-display)";

export default function WithdrawSuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const rawAmount = searchParams?.get("amount") || "0";
  const numericAmount = parseFloat(rawAmount) || 0;

  const [bankInfo, setBankInfo] = useState<any>(null);
  const refNumber = `PAY-${94820 + (Math.floor(numericAmount) % 100)}`;

  useEffect(() => {
    if (!user) return;
    fetch(`/api/seller/setup-account?userId=${user.id}`)
      .then((res) => res.json())
      .then((data) => setBankInfo(data))
      .catch((err) => console.error(err));
  }, [user]);

  return (
    <div className="min-h-screen bg-[var(--yrdly-dark)] text-foreground flex flex-col items-center justify-center p-6 text-center font-yrdly-body">
      <div className="max-w-md w-full p-8 rounded-3xl bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] backdrop-blur-xl space-y-6 shadow-2xl">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-foreground font-yrdly-display">
            Withdrawal Requested!
          </h1>
          <p className="text-sm text-[var(--yrdly-label)] font-yrdly-body">
            Your payout request of{" "}
            <span className="font-bold text-foreground font-yrdly-display">
              ₦{numericAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>{" "}
            has been received and is being processed.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-background/50 border border-[var(--yrdly-glass-border)] text-left space-y-3 text-xs font-yrdly-body">
          <div className="flex justify-between items-center text-[var(--yrdly-label)]">
            <span>Reference</span>
            <span className="font-bold text-foreground uppercase font-yrdly-display">{refNumber}</span>
          </div>

          {bankInfo?.account_number && (
            <div className="flex justify-between items-center text-[var(--yrdly-label)] pt-2 border-t border-[var(--yrdly-glass-border)]">
              <span className="flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-primary" /> Destination
              </span>
              <span className="font-bold text-foreground">
                {bankInfo.bank_name} • {bankInfo.account_number}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center text-[var(--yrdly-label)] pt-2 border-t border-[var(--yrdly-glass-border)]">
            <span>Estimated Arrival</span>
            <span className="font-bold text-foreground">1 - 2 Business Hours</span>
          </div>
        </div>

        <button
          onClick={() => router.push("/settings/payouts")}
          className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-sm shadow-lg hover:opacity-90 transition-all flex items-center justify-center gap-2 font-yrdly-body"
        >
          Back to Payouts <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
