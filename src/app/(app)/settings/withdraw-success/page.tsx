"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Building, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-jersey25)";

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
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full p-8 rounded-3xl bg-card border border-border/40 space-y-6 shadow-2xl">
        <div className="w-16 h-16 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-foreground" style={{ fontFamily: RALEWAY }}>
            Withdrawal Requested!
          </h1>
          <p className="text-sm text-muted-foreground" style={{ fontFamily: FONT }}>
            Your payout request of{" "}
            <span className="font-bold text-foreground">
              ₦{numericAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>{" "}
            has been received and is being processed.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-background border border-border/40 text-left space-y-3 text-xs" style={{ fontFamily: FONT }}>
          <div className="flex justify-between items-center text-muted-foreground">
            <span>Reference</span>
            <span className="font-bold text-foreground uppercase">{refNumber}</span>
          </div>

          {bankInfo?.account_number && (
            <div className="flex justify-between items-center text-muted-foreground pt-2 border-t border-border/40">
              <span className="flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-primary" /> Destination
              </span>
              <span className="font-bold text-foreground">
                {bankInfo.bank_name} • {bankInfo.account_number}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center text-muted-foreground pt-2 border-t border-border/40">
            <span>Estimated Arrival</span>
            <span className="font-bold text-foreground">1 - 2 Business Hours</span>
          </div>
        </div>

        <button
          onClick={() => router.push("/settings/payouts")}
          className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-sm shadow-lg hover:opacity-90 transition-all flex items-center justify-center gap-2"
          style={{ fontFamily: FONT }}
        >
          Back to Payouts <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
