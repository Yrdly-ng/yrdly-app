"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Building2, CheckCircle, AlertCircle, Loader2, Sparkles } from "lucide-react";

/* ── Design tokens ─────────────────────────────────── */
const BG     = "var(--c-bg)";
const CARD   = "var(--c-card)";
const CARDH  = "var(--c-card2)";
const GREEN  = "#388E3C";
const GREEN_L = "#82DB7E";
const MUTED  = "var(--c-text-muted)";
const DIM    = "var(--c-text-muted)";

const NIGERIAN_BANKS = [
  { code: "044", name: "Access Bank" },
  { code: "023", name: "Citibank Nigeria" },
  { code: "063", name: "Diamond Bank" },
  { code: "050", name: "Ecobank Nigeria" },
  { code: "084", name: "Enterprise Bank" },
  { code: "070", name: "Fidelity Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "214", name: "First City Monument Bank" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "030", name: "Heritage Bank" },
  { code: "301", name: "Jaiz Bank" },
  { code: "082", name: "Keystone Bank" },
  { code: "526", name: "Parallex Bank" },
  { code: "076", name: "Polaris Bank" },
  { code: "101", name: "Providus Bank" },
  { code: "221", name: "Stanbic IBTC Bank" },
  { code: "068", name: "Standard Chartered" },
  { code: "232", name: "Sterling Bank" },
  { code: "100", name: "Suntrust Bank" },
  { code: "032", name: "Union Bank of Nigeria" },
  { code: "033", name: "United Bank for Africa" },
  { code: "215", name: "Unity Bank" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
  { code: "100004", name: "OPay" },
  { code: "100033", name: "PalmPay" },
  { code: "090267", name: "Kuda Microfinance Bank" },
];

interface ExistingAccount {
  accountName: string;
  accountNumber: string;
  bankCode: string;
  isVerified: boolean;
  createdAt: string;
}

export default function PayoutSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const { user } = useAuth();
  const { toast } = useToast();

  const [bankCode, setBankCode]         = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName]   = useState("");
  const [loading, setLoading]           = useState(false);
  const [fetching, setFetching]         = useState(true);
  const [existing, setExisting]         = useState<ExistingAccount | null>(null);
  const [showForm, setShowForm]         = useState(false);

  // Fetch existing account on mount
  useEffect(() => {
    async function fetchAccount() {
      if (!user) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/seller/setup-account", {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        const data = await res.json();
        if (data.account) {
          setExisting(data.account);
        } else {
          setShowForm(true);
        }
      } catch (err) {
        console.error("Failed to fetch account:", err);
        setShowForm(true);
      } finally {
        setFetching(false);
      }
    }
    fetchAccount();
  }, [user]);

  const handleSubmit = useCallback(async () => {
    if (!bankCode || !accountNumber || !accountName) {
      toast({ title: "Missing fields", description: "Please fill in all fields.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/seller/setup-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ bankCode, accountNumber, accountName }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Failed to link account.", variant: "destructive" });
        return;
      }

      toast({ title: "Account linked!", description: "Your bank account is ready to receive payments." });
      setExisting({ accountName, accountNumber, bankCode, isVerified: true, createdAt: new Date().toISOString() });
      setShowForm(false);

      // If we came from a creation flow, send the user directly back there
      if (returnTo) {
        setTimeout(() => router.push(`/${returnTo}`), 800);
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [bankCode, accountNumber, accountName, toast, returnTo, router]);

  const getBankName = (code: string) =>
    NIGERIAN_BANKS.find((b) => b.code === code)?.name || code;

  // Auto-resolve account name
  useEffect(() => {
    async function resolveAccount() {
      if (bankCode && accountNumber.length === 10) {
        setLoading(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch("/api/seller/resolve-account", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ bankCode, accountNumber }),
          });
          const data = await res.json();
          if (res.ok && data.accountName) {
            setAccountName(data.accountName);
            toast({ title: "Account Resolved", description: `Found account for ${data.accountName}` });
          } else {
            setAccountName("");
            toast({ title: "Resolution Failed", description: data.error || "Could not resolve account.", variant: "destructive" });
          }
        } catch (err) {
          toast({ title: "Resolution Failed", description: "Network error occurred.", variant: "destructive" });
        } finally {
          setLoading(false);
        }
      }
    }
    resolveAccount();
  }, [bankCode, accountNumber, toast]);

  if (fetching) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: BG }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: GREEN_L }} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-20" style={{ background: "var(--background)", color: "var(--foreground)", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <header
        className="fixed top-0 w-full z-50 flex items-center border-b border-border"
        style={{ 
          background: "rgba(13,15,17,0.85)", 
          backdropFilter: "blur(20px)",
          height: "calc(64px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)"
        }}
      >
        <div className="w-full max-w-2xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => router.back()} 
              className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 border border-border hover:bg-accent transition-all active:scale-90"
            >
              <ArrowLeft className="w-5 h-5" style={{ color: "#388E3C" }} />
            </button>
            <h1 className="text-xl font-black text-foreground tracking-tight">
              Payout Settings
            </h1>
          </div>
          <div className="w-10 h-10 rounded-full bg-[#388E3C]/10 border border-[#388E3C]/20 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-[#388E3C]" />
          </div>
        </div>
      </header>

      <main className="pt-[calc(84px+env(safe-area-inset-top))] px-6 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Return-to context banner */}
        {returnTo && (
          <section
            className="rounded-[20px] p-4 flex items-center gap-3"
            style={{ background: "rgba(56,142,60,0.08)", border: "1px solid rgba(56,142,60,0.25)" }}
          >
            <div className="w-8 h-8 rounded-xl bg-[#388E3C]/20 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-4 h-4 text-[#388E3C]" />
            </div>
            <p className="text-xs font-bold text-[#82DB7E]">
              Link your bank account and we&apos;ll take you straight back to finish creating your{" "}
              {returnTo.includes("event") ? "event" : "listing"}.
            </p>
          </section>
        )}

        {/* Info banner */}
        <section
          className="rounded-[24px] p-5 flex gap-4 items-start relative overflow-hidden"
          style={{ background: "rgba(56,142,60,0.05)", border: "1px solid rgba(56,142,60,0.2)" }}
        >
          <div className="absolute top-0 right-0 p-4 opacity-5">
            <Building2 size={80} className="text-[#388E3C]" />
          </div>
          <div className="w-10 h-10 rounded-2xl bg-[#388E3C]/20 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-[#388E3C]" />
          </div>
          <div className="relative z-10 space-y-1">
            <p className="text-sm font-black text-foreground">
              Smart Payout Splitting
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground font-medium">
              When you sell, <span className="text-foreground font-bold">97%</span> goes directly to you. A tiny <span className="text-foreground font-bold">3%</span> platform fee keeps the neighborhood running.
            </p>
          </div>
        </section>

        {/* Existing account display */}
        {existing && !showForm && (
          <section 
            className="rounded-[32px] p-8 space-y-6 relative overflow-hidden group" 
            style={{ 
              background: "var(--card)",
              border: "1px solid rgba(255,255,255,0.05)",
              boxShadow: "0 20px 40px -12px rgba(0,0,0,0.5)"
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-[#388E3C]/10 flex items-center justify-center border border-[#388E3C]/20">
                  <CheckCircle className="w-6 h-6 text-[#388E3C]" />
                </div>
                <div>
                  <h3 className="font-black text-foreground">Bank Linked</h3>
                  <p className="text-xs font-bold text-[#388E3C] uppercase tracking-widest">Verified Account</p>
                </div>
              </div>
              <div className="text-[10px] font-black text-muted-foreground uppercase tracking-tighter opacity-40">
                Primary
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex justify-between items-center">
                <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Account Holder</span>
                <span className="text-sm font-bold text-foreground">{existing.accountName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Account Number</span>
                <span className="text-sm font-bold text-foreground tracking-widest">
                  •••• •••• {existing.accountNumber.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Financial Institution</span>
                <span className="text-sm font-bold text-foreground">{getBankName(existing.bankCode)}</span>
              </div>
            </div>

            <button
              onClick={() => setShowForm(true)}
              className="w-full h-14 rounded-2xl text-xs font-black uppercase tracking-widest text-foreground transition-all border border-border bg-white/[0.03] hover:bg-white/[0.08] active:scale-95"
            >
              Update Bank Details
            </button>
          </section>
        )}

        {/* Bank details form */}
        {showForm && (
          <section 
            className="rounded-[32px] p-8 space-y-8 animate-in zoom-in-95 duration-300" 
            style={{ 
              background: "var(--card)",
              border: "1px solid rgba(255,255,255,0.05)",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)"
            }}
          >
            <div className="space-y-1">
              <h2 className="text-xl font-black text-foreground">
                {existing ? "Update" : "Add"} Bank Account
              </h2>
              <p className="text-xs text-muted-foreground font-medium">
                Enter your local bank details to receive payments.
              </p>
            </div>

            <div className="space-y-6">
              {/* Bank selection */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.2em] font-black text-muted-foreground ml-1">
                  Select Bank
                </label>
                <div className="relative">
                  <select
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    className="w-full h-14 rounded-2xl p-4 text-base bg-white/5 border border-border focus:border-[#388E3C]/50 focus:outline-none transition-all appearance-none cursor-pointer text-foreground font-medium"
                  >
                    <option value="" className="bg-card">Choose institution...</option>
                    {NIGERIAN_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.code} className="bg-card">
                        {bank.name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                    <ArrowLeft className="w-4 h-4 rotate-[270deg]" />
                  </div>
                </div>
              </div>

              {/* Account number */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.2em] font-black text-muted-foreground ml-1">
                  Account Number
                </label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="0123456789"
                  maxLength={10}
                  className="w-full h-14 rounded-2xl p-4 text-base bg-white/5 border border-border focus:border-[#388E3C]/50 focus:outline-none transition-all text-foreground font-medium placeholder:text-muted-foreground"
                />
              </div>

              {/* Account name */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.2em] font-black text-muted-foreground ml-1">
                  Account Holder Name
                </label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full h-14 rounded-2xl p-4 text-base bg-white/5 border border-border focus:border-[#388E3C]/50 focus:outline-none transition-all text-foreground font-medium placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {/* Submit */}
            <div className="space-y-4">
              <button
                onClick={handleSubmit}
                disabled={loading || !bankCode || !accountNumber || !accountName}
                className="w-full h-16 rounded-[24px] flex items-center justify-center text-foreground text-lg font-black transition-all active:scale-95 disabled:opacity-50 disabled:grayscale group relative overflow-hidden"
                style={{
                  background: "#388E3C",
                  boxShadow: "0 12px 24px -6px rgba(56,142,60,0.4)"
                }}
              >
                <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10">
                  {loading ? (
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Linking...
                    </div>
                  ) : "Securely Link Account"}
                </span>
              </button>

              {existing && (
                <button
                  onClick={() => setShowForm(false)}
                  className="w-full h-12 rounded-2xl text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </section>
        )}

        {/* Security Note */}
        <div className="flex items-center justify-center gap-3 px-6 py-4 rounded-3xl bg-white/[0.02] border border-border">
          <AlertCircle className="w-4 h-4 text-muted-foreground" />
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Encrypted & PCI-DSS Compliant Storage
          </p>
        </div>
      </main>
    </div>
  );
}
