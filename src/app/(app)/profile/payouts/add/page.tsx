"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Check, Lock, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-supabase-auth";

/* ── Design tokens ─────────────────────────────────── */
const BG    = "var(--c-bg)";
const CARD  = "var(--c-card)";
const CARDH = "var(--c-card2)";
const Green  = "#388E3C";
const GreenL = "#82DB7E";
const MUTED  = "var(--c-text-muted)";

const NIGERIAN_BANKS = [
  "Access Bank", "GTBank", "First Bank", "Zenith Bank",
  "UBA", "Stanbic IBTC", "Fidelity Bank", "Sterling Bank",
  "Polaris Bank", "Wema Bank", "Keystone Bank", "Jaiz Bank",
  "OPay", "PalmPay", "Kuda Bank", "Moniepoint",
];

export default function AddPayoutAccountPage() {
  const router    = useRouter();
  const { toast } = useToast();
  const { user }  = useAuth();

  const [bankQuery, setBankQuery]       = useState("");
  const [bankOpen, setBankOpen]         = useState(false);
  const [selectedBank, setSelectedBank] = useState("");
  const [accNumber, setAccNumber]       = useState("");
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [verifying, setVerifying]       = useState(false);
  const [saving, setSaving]             = useState(false);

  const filtered = NIGERIAN_BANKS.filter((b) =>
    b.toLowerCase().includes(bankQuery.toLowerCase())
  );

  const handleVerify = async () => {
    if (!selectedBank || accNumber.length < 10) return;
    setVerifying(true);
    // Placeholder — wire to Flutterwave Resolve Account API
    await new Promise((r) => setTimeout(r, 1400));
    setVerifiedName(`${user?.user_metadata?.name ?? "Account Holder"}`);
    setVerifying(false);
  };

  const handleSave = async () => {
    if (!verifiedName) return;
    setSaving(true);
    // Placeholder — persist to Supabase profile_payment_accounts
    await new Promise((r) => setTimeout(r, 1000));
    toast({ title: "Account saved!", description: `${selectedBank} ••••${accNumber.slice(-4)} added.` });
    router.back();
  };

  return (
    <div
      className="min-h-dvh flex flex-col items-center"
      style={{ background: BG, color: "var(--c-text)", fontFamily: "Inter, sans-serif" }}
    >
      {/* Aura glows */}
      <div className="fixed -z-10 top-0 right-0 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "rgba(77,162,78,0.04)", filter: "blur(120px)" }} />
      <div className="fixed -z-10 bottom-0 left-0 w-[400px] h-[400px] rounded-full pointer-events-none" style={{ background: "rgba(0,110,201,0.04)", filter: "blur(100px)" }} />

      {/* Header */}
      <header
        className="fixed top-0 w-full z-50 flex items-center gap-4 px-6 h-16"
        style={{ background: "var(--c-bg)", backdropFilter: "blur(20px)" }}
      >
        <button onClick={() => router.back()} className="hover:opacity-70 transition-opacity">
          <ArrowLeft className="w-5 h-5" style={{ color: Green }} />
        </button>
        <h1 style={{ fontFamily: "Pacifico, cursive", fontSize: 22, color: "var(--c-text)" }}>
          Add Payout Account
        </h1>
      </header>

      <main className="w-full max-w-2xl px-6 pt-24 pb-12 flex-1 flex flex-col">

        {/* Intro */}
        <section className="mb-8">
          <p className="text-[0.75rem] mb-4" style={{ color: MUTED, fontFamily: "Inter, sans-serif" }}>
            Required to receive your marketplace earnings
          </p>
          <div
            className="flex items-center gap-2 p-3 rounded-lg"
            style={{ background: "rgba(130,219,126,0.08)" }}
          >
            <Lock className="w-4 h-4 flex-shrink-0" style={{ color: GreenL }} />
            <p className="text-[0.6875rem]" style={{ color: GreenL, fontFamily: "Inter, sans-serif" }}>
              Your account details are encrypted at rest
            </p>
          </div>
        </section>

        <div className="space-y-6 flex-1">

          {/* Bank selector */}
          <div className="space-y-2 relative">
            <label className="text-[0.8125rem] font-medium ml-4" style={{ color: MUTED, fontFamily: "Inter, sans-serif" }}>
              Select Bank
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search Nigerian banks..."
                value={bankQuery}
                onChange={(e) => { setBankQuery(e.target.value); setBankOpen(true); }}
                onFocus={() => setBankOpen(true)}
                className="w-full h-14 rounded-full px-6 pr-12 focus:outline-none transition-all"
                style={{
                  background: CARDH,
                  color: "var(--c-text)",
                  border: bankOpen ? `1px solid ${Green}` : "1px solid rgba(64,73,61,0.2)",
                  fontFamily: "Inter, sans-serif",
                }}
              />
              <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: MUTED }} />
            </div>
            {bankOpen && filtered.length > 0 && (
              <ul
                className="absolute z-20 w-full rounded-xl overflow-hidden shadow-2xl border"
                style={{ background: 'var(--c-card)', borderColor: "rgba(64,73,61,0.2)", top: "100%", marginTop: 4 }}
              >
                {filtered.slice(0, 7).map((b) => (
                  <li key={b}>
                    <button
                      className="w-full text-left px-5 py-3 text-sm hover:opacity-80 flex items-center justify-between transition-colors"
                      style={{ color: "var(--c-text)", fontFamily: "Inter, sans-serif" }}
                      onClick={() => { setSelectedBank(b); setBankQuery(b); setBankOpen(false); setVerifiedName(null); }}
                    >
                      {b}
                      {selectedBank === b && <Check className="w-4 h-4" style={{ color: GreenL }} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Account number */}
          <div className="space-y-2">
            <label className="text-[0.8125rem] font-medium ml-4" style={{ color: MUTED, fontFamily: "Inter, sans-serif" }}>
              Account Number
            </label>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit account number"
              value={accNumber}
              onChange={(e) => { setAccNumber(e.target.value.replace(/\D/g, "").slice(0, 10)); setVerifiedName(null); }}
              className="w-full h-14 rounded-full px-6 focus:outline-none transition-all"
              style={{
                background: CARDH,
                color: "var(--c-text)",
                border: "1px solid rgba(64,73,61,0.2)",
                fontFamily: "Inter, sans-serif",
                letterSpacing: "0.1em",
              }}
            />
          </div>

          {/* Verify */}
          <div className="flex flex-col gap-4">
            <button
              onClick={handleVerify}
              disabled={!selectedBank || accNumber.length < 10 || verifying}
              className="w-full h-14 rounded-full font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 border"
              style={{
                background: "transparent",
                borderColor: "rgba(77,162,78,0.4)",
                color: GreenL,
                fontFamily: "Inter, sans-serif",
                opacity: (!selectedBank || accNumber.length < 10) ? 0.4 : 1,
              }}
            >
              {verifying ? (
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: GreenL, animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: GreenL, animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: GreenL, animationDelay: "300ms" }} />
                </span>
              ) : "Verify Account"}
            </button>

            {verifiedName && (
              <div className="flex items-center gap-3 px-4 py-2 rounded-xl" style={{ background: "rgba(130,219,126,0.07)" }}>
                <Check className="w-5 h-5 flex-shrink-0" style={{ color: GreenL }} />
                <p className="text-[0.8125rem]" style={{ color: GreenL, fontFamily: "Inter, sans-serif" }}>
                  Account Name: <span className="font-bold">{verifiedName}</span>
                </p>
              </div>
            )}
          </div>

          {/* Verified name (read-only) */}
          <div className="space-y-2" style={{ opacity: verifiedName ? 1 : 0.4 }}>
            <label className="text-[0.8125rem] font-medium ml-4" style={{ color: MUTED, fontFamily: "Inter, sans-serif" }}>
              Verified Account Name
            </label>
            <input
              type="text"
              readOnly
              value={verifiedName ?? ""}
              placeholder="Will auto-fill after verification"
              className="w-full h-14 rounded-full px-6"
              style={{ background: "var(--c-bg)", color: MUTED, fontFamily: "Inter, sans-serif", cursor: "default", border: "1px solid rgba(64,73,61,0.1)" }}
            />
          </div>

          {/* Info note */}
          <div className="flex items-start gap-3 px-4 py-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: MUTED }} />
            <p className="text-[0.6875rem] leading-relaxed" style={{ color: MUTED, fontFamily: "Inter, sans-serif" }}>
              We verify your account via Flutterwave to ensure accurate payouts. Your data is protected by industry-standard protocols.
            </p>
          </div>
        </div>

        {/* CTAs */}
        <div className="mt-12 space-y-4">
          <button
            onClick={handleSave}
            disabled={!verifiedName || saving}
            className="w-full h-14 rounded-full font-bold text-lg transition-all active:scale-[0.98]"
            style={{
              background: verifiedName ? "#4da24e" : CARDH,
              color: verifiedName ? "#003207" : MUTED,
              fontFamily: "Inter, sans-serif",
              boxShadow: verifiedName ? "0 8px 24px rgba(77,162,78,0.2)" : "none",
              cursor: verifiedName ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving…" : "Save Account Details"}
          </button>
          <button
            onClick={() => router.back()}
            className="w-full py-2 text-sm hover:text-foreground transition-colors"
            style={{ color: MUTED, fontFamily: "Inter, sans-serif" }}
          >
            Cancel
          </button>
        </div>
      </main>
    </div>
  );
}
