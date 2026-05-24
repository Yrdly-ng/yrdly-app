"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { X, ShoppingBag, Banknote, Zap, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";

const GREEN = "#388E3C";
const DARK = "var(--c-bg)";
const CARD = "var(--c-card)";
const BORDER = "rgba(56,142,60,0.3)";

type ItemType = "free" | "paid" | null;
type Step = 1 | 2 | 3;

interface MarketplaceCreatorOnboardingProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void; // Called when they are ready to open the actual create item dialog
}

export function MarketplaceCreatorOnboarding({ isOpen, onClose, onContinue }: MarketplaceCreatorOnboardingProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [itemType, setItemType] = useState<ItemType>(null);
  const [hasPayout, setHasPayout] = useState<boolean | null>(null);
  const [checkingPayout, setCheckingPayout] = useState(false);

  // Check if user already has a payout account when modal opens
  useEffect(() => {
    if (!isOpen || !user) return;
    setStep(1);
    setItemType(null);
    const check = async () => {
      setCheckingPayout(true);
      const { data } = await supabase
        .from("seller_accounts")
        .select("id, verification_status")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .eq("is_primary", true)
        .maybeSingle();
      setHasPayout(!!data && data.verification_status === "verified");
      setCheckingPayout(false);
    };
    check();
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleItemTypeSelect = (type: ItemType) => {
    setItemType(type);
    if (type === "free") {
      // Skip payout step — go straight to step 3
      setStep(3);
    } else {
      // Paid — check payout and go to step 2
      if (hasPayout) {
        setStep(3);
      } else {
        setStep(2);
      }
    }
  };

  const handleGoToPayout = () => {
    onClose();
    router.push("/profile/payout-settings?returnTo=marketplace");
  };

  const handleCreateItem = () => {
    onClose();
    onContinue(); // Open the CreateItemDialog
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      >
        {/* Sheet */}
        <div
          className="relative w-full max-w-md rounded-t-3xl sm:rounded-3xl flex flex-col"
          style={{
            background: 'var(--c-card)',
            border: `1px solid ${BORDER}`,
            maxHeight: "92dvh",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Progress bar */}
          <div className="h-1 w-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.05)" }}>
            <div
              className="h-full transition-all duration-500"
              style={{ background: GREEN, width: step === 1 ? "33%" : step === 2 ? "66%" : "100%" }}
            />
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 min-w-[44px] min-h-[44px] p-2 flex items-center justify-center rounded-full z-10"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div
            className="overflow-y-auto flex-1 p-6"
            style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
          >
            {/* ── Step 1: Choose item type ── */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <p className="text-xs font-sans text-muted-foreground uppercase tracking-widest mb-1">Step 1 of 3</p>
                  <h2 className="text-2xl font-black text-foreground font-sans leading-tight">
                    What are you<br />listing?
                  </h2>
                  <p className="text-sm text-muted-foreground font-sans mt-2">
                    Choose how you want to list your item.
                  </p>
                </div>

                <div className="space-y-3">
                  {/* Free */}
                  <button
                    onClick={() => handleItemTypeSelect("free")}
                    className="w-full text-left p-4 rounded-2xl border transition-all hover:border-green-500/60 group"
                    style={{ background: "rgba(56,142,60,0.06)", borderColor: BORDER }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(56,142,60,0.15)" }}>
                        <ShoppingBag className="w-5 h-5" style={{ color: GREEN }} />
                      </div>
                      <div>
                        <p className="font-bold text-foreground font-sans text-[0.9375rem]">Free Item</p>
                        <p className="text-xs text-muted-foreground font-sans mt-0.5">Give away items you no longer need. No payment setup needed.</p>
                        <div className="flex items-center gap-1 mt-2">
                          <span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(56,142,60,0.2)", color: GREEN }}>
                            ✓ Start immediately
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-muted-foreground ml-auto flex-shrink-0 mt-3 transition-colors" />
                    </div>
                  </button>

                  {/* Paid */}
                  <button
                    onClick={() => handleItemTypeSelect("paid")}
                    className="w-full text-left p-4 rounded-2xl border transition-all hover:border-green-500/60 group"
                    style={{ background: "rgba(56,142,60,0.06)", borderColor: BORDER }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(56,142,60,0.15)" }}>
                        <Banknote className="w-5 h-5" style={{ color: GREEN }} />
                      </div>
                      <div>
                        <p className="font-bold text-foreground font-sans text-[0.9375rem]">Paid Item</p>
                        <p className="text-xs text-muted-foreground font-sans mt-0.5">Sell your items securely through Yrdly Escrow.</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(56,142,60,0.2)", color: GREEN }}>
                            You keep 95%
                          </span>
                          <span className="text-[0.6875rem] text-muted-foreground font-sans">Yrdly takes 5%</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-muted-foreground ml-auto flex-shrink-0 mt-3 transition-colors" />
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: Payout setup needed ── */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <p className="text-xs font-sans text-muted-foreground uppercase tracking-widest mb-1">Step 2 of 3</p>
                  <h2 className="text-2xl font-black text-foreground font-sans leading-tight">
                    Set up your<br />payout account
                  </h2>
                  <p className="text-sm text-muted-foreground font-sans mt-2">
                    To receive payments for sold items securely, link your bank account.
                  </p>
                </div>

                {/* How it works */}
                <div className="space-y-3">
                  {[
                    { icon: Zap, label: "Instant setup", desc: "Link your Nigerian bank account via Flutterwave" },
                    { icon: Banknote, label: "Escrow Protection", desc: "Funds are held securely until the buyer confirms delivery" },
                    { icon: CheckCircle2, label: "You keep 95%", desc: "Yrdly takes a 5% platform fee only on paid items" },
                  ].map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(56,142,60,0.15)" }}>
                        <Icon className="w-4 h-4" style={{ color: GREEN }} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground font-sans">{label}</p>
                        <p className="text-xs text-muted-foreground font-sans">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <button
                    onClick={handleGoToPayout}
                    className="w-full h-12 rounded-full font-sans font-bold text-foreground text-sm transition-opacity hover:opacity-90"
                    style={{ background: GREEN }}
                  >
                    Set Up Payout Account →
                  </button>
                  <button
                    onClick={() => setStep(1)}
                    className="w-full h-10 rounded-full font-sans text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← Go back
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: All set ── */}
            {step === 3 && (
              <div className="space-y-6 text-center">
                <div>
                  <p className="text-xs font-sans text-muted-foreground uppercase tracking-widest mb-4">Step 3 of 3</p>
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"
                    style={{ background: "rgba(56,142,60,0.15)" }}
                  >
                    <CheckCircle2 className="w-10 h-10" style={{ color: GREEN }} />
                  </div>
                  <h2 className="text-2xl font-black text-foreground font-sans">
                    You&apos;re all set!
                  </h2>
                  <p className="text-sm text-muted-foreground font-sans mt-2">
                    {itemType === "free"
                      ? "List your free item for your neighbors."
                      : "Your payout account is ready. List your item and start selling securely."}
                  </p>
                </div>

                {/* Checklist */}
                <div className="text-left space-y-2">
                  {[
                    "Add clear photos of your item",
                    "Set a fair price (or free)",
                    "Publish to the neighborhood marketplace",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(56,142,60,0.2)" }}>
                        <span className="text-[0.625rem] font-bold" style={{ color: GREEN }}>{i + 1}</span>
                      </div>
                      <span className="text-sm text-muted-foreground font-sans">{item}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleCreateItem}
                  className="w-full h-12 rounded-full font-sans font-bold text-foreground text-sm transition-opacity hover:opacity-90"
                  style={{ background: GREEN }}
                >
                  List My Item →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
