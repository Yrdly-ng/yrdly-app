"use client";

import { useState, useEffect } from "react";
import { X, Store, Wrench, ImagePlus, MapPinned, CheckCircle2, ArrowRight } from "lucide-react";

const GREEN = "hsl(var(--primary))";
const BORDER = "rgba(56,142,60,0.3)";

type BusinessType = "product" | "service" | null;
type Step = 1 | 2 | 3;

interface BusinessCreatorOnboardingProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
}

export function BusinessCreatorOnboarding({ isOpen, onClose, onContinue }: BusinessCreatorOnboardingProps) {
  const [step, setStep] = useState<Step>(1);
  const [businessType, setBusinessType] = useState<BusinessType>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setBusinessType(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTypeSelect = (type: BusinessType) => {
    setBusinessType(type);
    setStep(2);
  };

  const handleBuildListing = () => {
    onClose();
    onContinue();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      >
        {/* Sheet */}
        <div
          className="relative w-full max-w-md rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden"
          style={{
            background: "var(--c-card)",
            border: `1px solid ${BORDER}`,
            maxHeight: "92dvh",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Progress bar */}
          <div className="h-1 w-full flex-shrink-0" style={{ background: "var(--c-border)" }}>
            <div
              className="h-full transition-all duration-500"
              style={{ background: GREEN, width: step === 1 ? "33%" : step === 2 ? "66%" : "100%" }}
            />
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 min-w-[44px] min-h-[44px] p-2 flex items-center justify-center rounded-full z-10"
            style={{ background: "var(--c-border)" }}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div
            className="overflow-y-auto flex-1 p-6"
            style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
          >
            {/* ── Step 1: Choose business type ── */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <p className="text-xs font-sans text-muted-foreground uppercase tracking-widest mb-1">Step 1 of 3</p>
                  <h2 className="text-2xl font-black text-foreground font-sans leading-tight">
                    What kind of<br />business are you listing?
                  </h2>
                  <p className="text-sm text-muted-foreground font-sans mt-2">
                    Choose your business type to get started.
                  </p>
                </div>

                <div className="space-y-3">
                  {/* Product-based */}
                  <button
                    onClick={() => handleTypeSelect("product")}
                    className="w-full text-left p-4 rounded-2xl border transition-all hover:border-green-500/60 group"
                    style={{ background: "rgba(56,142,60,0.06)", borderColor: BORDER }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(56,142,60,0.15)" }}>
                        <Store className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-bold text-foreground font-sans text-[0.9375rem]">Product-Based Shop</p>
                        <p className="text-xs text-muted-foreground font-sans mt-0.5">Retail, food, boutique — sell physical items with a catalog.</p>
                        <div className="flex items-center gap-1 mt-2">
                          <span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded-full text-primary" style={{ background: "rgba(56,142,60,0.2)" }}>
                            ✓ Catalog included
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-muted-foreground ml-auto flex-shrink-0 mt-3 transition-colors" />
                    </div>
                  </button>

                  {/* Service-based */}
                  <button
                    onClick={() => handleTypeSelect("service")}
                    className="w-full text-left p-4 rounded-2xl border transition-all hover:border-green-500/60 group"
                    style={{ background: "rgba(56,142,60,0.06)", borderColor: BORDER }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(56,142,60,0.15)" }}>
                        <Wrench className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-bold text-foreground font-sans text-[0.9375rem]">Service Provider</p>
                        <p className="text-xs text-muted-foreground font-sans mt-0.5">Salons, repairs, tutoring, contractors — book direct with neighbors.</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded-full text-primary" style={{ background: "rgba(56,142,60,0.2)" }}>
                            Direct messaging
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-muted-foreground ml-auto flex-shrink-0 mt-3 transition-colors" />
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: What you'll need ── */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <p className="text-xs font-sans text-muted-foreground uppercase tracking-widest mb-1">Step 2 of 3</p>
                  <h2 className="text-2xl font-black text-foreground font-sans leading-tight">
                    What you&apos;ll<br />need
                  </h2>
                  <p className="text-sm text-muted-foreground font-sans mt-2">
                    Have these ready and listing takes about 2 minutes.
                  </p>
                </div>

                <div className="space-y-3">
                  {[
                    { icon: ImagePlus, label: "Photos", desc: "At least one clear photo of your storefront or work" },
                    { icon: MapPinned, label: "Location", desc: "Your business address so neighbors can find you" },
                    { icon: CheckCircle2, label: "Contact details", desc: "Phone and hours so people know when to reach you" },
                  ].map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex items-center gap-3 p-3 rounded-xl" style={{ border: "1px solid var(--c-border)" }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(56,142,60,0.15)" }}>
                        <Icon className="w-4 h-4 text-primary" />
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
                    onClick={() => setStep(3)}
                    className="w-full h-12 rounded-full font-sans font-bold text-foreground text-sm transition-opacity hover:opacity-90"
                    style={{ background: GREEN }}
                  >
                    Continue →
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
                    <CheckCircle2 className="w-10 h-10 text-primary" />
                  </div>
                  <h2 className="text-2xl font-black text-foreground font-sans">
                    You&apos;re all set!
                  </h2>
                  <p className="text-sm text-muted-foreground font-sans mt-2">
                    {businessType === "product"
                      ? "Set up your shop and start adding items to your catalog."
                      : "List your service and let your neighbors reach out directly."}
                  </p>
                </div>

                {/* Checklist */}
                <div className="text-left space-y-2">
                  {[
                    "Set your business name, category & description",
                    "Add your location, hours & contact info",
                    "Publish to your neighborhood",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(56,142,60,0.2)" }}>
                        <span className="text-[0.625rem] font-bold text-primary">{i + 1}</span>
                      </div>
                      <span className="text-sm text-muted-foreground font-sans">{item}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleBuildListing}
                  className="w-full h-12 rounded-full font-sans font-bold text-foreground text-sm transition-opacity hover:opacity-90"
                  style={{ background: GREEN }}
                >
                  Build My Business Listing →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}