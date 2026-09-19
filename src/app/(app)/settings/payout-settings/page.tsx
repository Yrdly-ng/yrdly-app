"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  CheckCircle2,
  Check,
  Hash,
} from "lucide-react";
import { BankLogo } from "@/components/BankLogo";
import { useToast } from "@/hooks/use-toast";

interface BankItem {
  name: string;
  code: string;
}

export default function PayoutSettingsPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [existingBank, setExistingBank] = useState<any>(null);
  const [isChangingBank, setIsChangingBank] = useState(false);

  // Verification flow state
  const [step, setStep] = useState<"select" | "account" | "verifying" | "confirmed">("select");

  const [banks, setBanks] = useState<BankItem[]>([]);
  const [bankSearch, setBankSearch] = useState("");
  const [selectedBank, setSelectedBank] = useState<BankItem | null>(null);

  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchExisting = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/seller/setup-account");
      if (res.ok) {
        const data = await res.json();
        if (data.account) {
          setExistingBank(data.account);
        } else {
          setIsChangingBank(true);
        }
      } else {
        setIsChangingBank(true);
      }
    } catch (e) {
      console.error(e);
      setIsChangingBank(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBanks = useCallback(async () => {
    try {
      const res = await fetch("/api/paystack/banks");
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          setBanks(data.data);
          return;
        }
      }
      // Fallback
      const fallbackRes = await fetch("https://api.paystack.co/bank?currency=NGN");
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        if (fallbackData.status) {
          setBanks(fallbackData.data);
        }
      }
    } catch (e) {
      console.error("Failed to fetch banks", e);
    }
  }, []);

  useEffect(() => {
    fetchExisting();
    fetchBanks();
  }, [fetchExisting, fetchBanks]);

  const getBankName = useCallback(
    (code: string) => {
      if (!code) return "";
      const bank = banks.find((b) => b.code === code);
      return bank ? bank.name : code;
    },
    [banks]
  );

  const resolveBank = async (bankCode: string, acctNum: string) => {
    setStep("verifying");
    setResolvedName("");
    try {
      const res = await fetch("/api/paystack/resolve-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber: acctNum, bankCode }),
      });
      const data = await res.json();
      if (res.ok && (data.success || data.accountName)) {
        setResolvedName(data.accountName);
        setTimeout(() => setStep("confirmed"), 600);
      } else {
        setStep("account");
        toast({ title: "Verification Failed", description: "Could not verify this account number.", variant: "destructive" });
      }
    } catch (e: any) {
      setStep("account");
      toast({ title: "Verification Failed", description: e.message || "An error occurred while verifying.", variant: "destructive" });
    }
  };

  const handleAcctChange = (val: string) => {
    const num = val.replace(/\D/g, "").slice(0, 10);
    setAccountNumber(num);
    if (step === "confirmed") setStep("account");
    if (num.length === 10 && selectedBank) {
      resolveBank(selectedBank.code, num);
    }
  };

  const handleSave = async () => {
    if (!selectedBank || !accountNumber || !resolvedName) return;
    setSaving(true);
    try {
      const res = await fetch("/api/seller/setup-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_number: accountNumber,
          bank_code: selectedBank.code,
          bank_name: selectedBank.name,
          account_name: resolvedName,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save bank account");
      }

      toast({ title: "Success", description: "Bank account saved successfully." });
      router.push("/settings/payouts");
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to save bank account", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--yrdly-dark)] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#82DB7E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (existingBank && !isChangingBank) {
    return (
      <div className="min-h-screen bg-[var(--yrdly-dark)] text-[var(--yrdly-text)] pb-20 font-yrdly-body">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-[var(--yrdly-dark)]/80 backdrop-blur-md px-5 py-3 border-b border-[var(--yrdly-glass-border)]">
          <div className="max-w-xl mx-auto flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="w-8 h-8 rounded-[11px] bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] flex items-center justify-center text-[var(--yrdly-text)] hover:opacity-80 transition-opacity"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h1 className="text-[18px] font-bold text-[var(--yrdly-text)] font-yrdly-display">
              Payout Settings
            </h1>
          </div>
        </header>

        <main className="max-w-xl mx-auto px-5 py-6 space-y-4">
          <div className="p-5 rounded-[24px] bg-[var(--yrdly-surface-alt)] border border-[var(--yrdly-glass-border)] space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-[14px] bg-[rgba(130,219,126,0.08)] flex items-center justify-center flex-shrink-0">
                <BankLogo
                  code={existingBank.bankCode || existingBank.bank_code}
                  name={getBankName(existingBank.bankCode || existingBank.bank_code)}
                  size={44}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold text-[var(--yrdly-text)] font-yrdly-display truncate">
                  {getBankName(existingBank.bankCode || existingBank.bank_code) || existingBank.bank_name || "Bank Account"}
                </p>
                <p className="text-[12px] text-[var(--yrdly-label)] font-yrdly-body">
                  {existingBank.accountNumber || existingBank.account_number}
                </p>
              </div>
              <div className="px-2.5 py-1 rounded-[8px] bg-[rgba(130,219,126,0.1)] border border-[rgba(130,219,126,0.2)]">
                <span className="text-[11px] font-bold text-[#82DB7E] font-yrdly-display uppercase">
                  ACTIVE
                </span>
              </div>
            </div>

            <p className="text-[13px] text-[var(--yrdly-muted)] font-yrdly-body">
              {existingBank.accountName || existingBank.account_name}
            </p>

            <div className="flex items-center gap-1.5 pt-1 text-[12px] text-[var(--yrdly-label)] font-yrdly-body">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#82DB7E]" />
              <span>Verified by Payluk</span>
            </div>
          </div>

          <button
            onClick={() => setIsChangingBank(true)}
            className="w-full py-4 rounded-[18px] bg-[#82DB7E] text-black font-bold text-[16px] font-yrdly-display hover:opacity-90 transition-opacity"
          >
            Change Bank Account
          </button>
        </main>
      </div>
    );
  }

  const filteredBanks = banks.filter((b) =>
    b.name.toLowerCase().includes(bankSearch.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[var(--yrdly-dark)] text-[var(--yrdly-text)] pb-20 font-yrdly-body">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--yrdly-dark)]/80 backdrop-blur-md px-5 py-3 border-b border-[var(--yrdly-glass-border)]">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <button
            onClick={() => {
              if (step !== "select") {
                setStep("select");
                setAccountNumber("");
                setResolvedName("");
              } else {
                if (existingBank) setIsChangingBank(false);
                else router.back();
              }
            }}
            className="w-8 h-8 rounded-[11px] bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] flex items-center justify-center text-[var(--yrdly-text)] hover:opacity-80 transition-opacity"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-[18px] font-bold text-[var(--yrdly-text)] font-yrdly-display">
              {step === "select" ? "Select Bank" : "Verify Account"}
            </h1>
            {step !== "select" && selectedBank && (
              <p className="text-[12px] text-[var(--yrdly-label)] font-yrdly-body">
                {selectedBank.name}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-5 py-4 space-y-4">
        {step === "select" && (
          <div className="space-y-4">
            {/* Search Box */}
            <div className="flex items-center gap-2 px-3 h-[42px] bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] rounded-[14px]">
              <Search className="w-4 h-4 text-[var(--yrdly-label)]" />
              <input
                type="text"
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                placeholder="Search banks…"
                className="w-full bg-transparent text-[14px] text-[var(--yrdly-text)] placeholder-[var(--yrdly-label)] outline-none font-yrdly-body"
              />
            </div>

            {/* Bank List */}
            <div className="bg-[var(--yrdly-surface-alt)] border border-[var(--yrdly-glass-border)] rounded-[22px] overflow-hidden">
              {filteredBanks.map((item, index) => (
                <div key={item.code}>
                  <button
                    onClick={() => {
                      setSelectedBank(item);
                      setStep("account");
                      setAccountNumber("");
                      setResolvedName("");
                    }}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-white/5 transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-[10px] bg-[rgba(130,219,126,0.06)] border border-[var(--yrdly-glass-border)] flex items-center justify-center flex-shrink-0">
                      <BankLogo code={item.code} name={item.name} size={36} />
                    </div>
                    <span className="flex-1 text-[15px] font-medium text-[var(--yrdly-text)] font-yrdly-body">
                      {item.name}
                    </span>
                    <ChevronRight className="w-4 h-4 text-[var(--yrdly-label)]" />
                  </button>
                  {index < filteredBanks.length - 1 && (
                    <div className="h-[1px] bg-[var(--yrdly-glass-border)] ml-[72px]" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(step === "account" || step === "verifying" || step === "confirmed") && (
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-[1px] text-[var(--yrdly-label)] mb-2 font-yrdly-body">
                10-DIGIT ACCOUNT NUMBER (NUBAN)
              </label>
              <div
                className={`flex items-center gap-2 px-4 h-[58px] rounded-[18px] bg-[var(--yrdly-surface)] border transition-all ${
                  step === "confirmed"
                    ? "border-[rgba(130,219,126,0.4)]"
                    : "border-[var(--yrdly-glass-border)]"
                }`}
              >
                <Hash className="w-4 h-4 text-[var(--yrdly-label)]" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={(e) => handleAcctChange(e.target.value)}
                  placeholder="0000000000"
                  maxLength={10}
                  className="w-full bg-transparent text-[20px] font-bold text-[var(--yrdly-text)] tracking-[2px] placeholder-[var(--yrdly-label)] outline-none font-yrdly-display"
                />
                {step === "verifying" && (
                  <div className="w-5 h-5 border-2 border-[#82DB7E] border-t-transparent rounded-full animate-spin" />
                )}
                {step === "confirmed" && <Check className="w-5 h-5 text-[#82DB7E]" />}
              </div>
              <p className="text-[12px] text-[var(--yrdly-label)] mt-1.5 ml-1 font-yrdly-body">
                {accountNumber.length}/10 digits
              </p>
            </div>

            {step === "verifying" && (
              <div className="flex items-center gap-3 px-4 py-3.5 bg-[rgba(100,181,246,0.06)] border border-[rgba(100,181,246,0.2)] rounded-[14px]">
                <p className="text-[13px] text-[#64B5F6] font-yrdly-body">
                  Verifying account with Payluk…
                </p>
              </div>
            )}

            {step === "confirmed" && (
              <div className="flex items-center gap-4 px-4 py-4 bg-[rgba(130,219,126,0.06)] border border-[rgba(130,219,126,0.25)] rounded-[18px]">
                <div className="w-10 h-10 rounded-full bg-[rgba(130,219,126,0.1)] border border-[rgba(130,219,126,0.25)] flex items-center justify-center flex-shrink-0">
                  <Check className="w-5 h-5 text-[#82DB7E]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-[var(--yrdly-label)] mb-0.5 font-yrdly-body">
                    ACCOUNT HOLDER
                  </p>
                  <p className="text-[18px] font-bold text-[var(--yrdly-text)] truncate font-yrdly-display">
                    {resolvedName}
                  </p>
                  <p className="text-[12px] text-[#82DB7E] mt-0.5 font-yrdly-body">
                    Verified by Payluk ✓
                  </p>
                </div>
              </div>
            )}

            {step === "confirmed" && (
              <div className="pt-6">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full py-4 rounded-[18px] bg-[#82DB7E] text-black font-bold text-[16px] font-yrdly-display hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center"
                >
                  {saving ? (
                    <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "Save Bank Account"
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
