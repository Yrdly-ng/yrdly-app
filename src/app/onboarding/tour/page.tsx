"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOnboarding } from "@/hooks/use-onboarding";
import { onboardingAnalytics } from "@/lib/onboarding-analytics";
import { ArrowLeft, ArrowRight, Check, Sparkles, Globe, ShoppingBag, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────
   Slide definitions
 ───────────────────────────────────────────── */
const SLIDES = [
  {
    id: "loop",
    title: "Vibrant Community",
    body: "Experience your neighborhood like never before. Real stories, real people, real connections.",
    icon: Globe,
    gradient: "from-primary to-[#82DB7E]",
    accent: "hsl(var(--primary))"
  },
  {
    id: "trade",
    title: "Marketplace Magic",
    body: "Securely trade items with trusted neighbors. No shipping, no stress, just local value.",
    icon: ShoppingBag,
    gradient: "from-[#82DB7E] to-[#4da24e]",
    accent: "#82DB7E"
  },
  {
    id: "business",
    title: "Local Excellence",
    body: "Support the gems in your backyard. Discover businesses that make your street special.",
    icon: Sparkles,
    gradient: "from-[#4da24e] to-primary",
    accent: "#4da24e"
  },
  {
    id: "connect",
    title: "Digital Handshake",
    body: "Build a network of trust. Connect with verified neighbors and grow your local influence.",
    icon: Zap,
    gradient: "from-primary to-[#82DB7E]",
    accent: "hsl(var(--primary))"
  },
] as const;

export default function OnboardingTourPage() {
  const { completeTour, skipTour } = useOnboarding();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [direction, setDirection] = useState(1); // 1 for next, -1 for back

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const isLast = step === SLIDES.length - 1;

  const handleNext = async () => {
    if (isLast) {
      try {
        onboardingAnalytics.trackTourCompleted(SLIDES.length, SLIDES.length);
        await completeTour();
      } catch {}
      router.push("/home");
    } else {
      setDirection(1);
      setIsVisible(false);
      setTimeout(() => {
        setStep(prev => prev + 1);
        setIsVisible(true);
      }, 300);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setDirection(-1);
      setIsVisible(false);
      setTimeout(() => {
        setStep(prev => prev - 1);
        setIsVisible(true);
      }, 300);
    }
  };

  const handleSkip = async () => {
    try {
      onboardingAnalytics.trackTourSkipped("user_skipped");
      await skipTour();
    } catch {}
    router.push("/home");
  };

  const slide = SLIDES[step];
  const Icon = slide.icon;

  return (
    <div className="min-h-[100dvh] relative flex flex-col items-center justify-between overflow-hidden px-6 py-12 bg-background" style={{ fontFamily: "var(--font-work-sans)" }}>
      
      {/* Background Animated Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full blur-[120px] opacity-20 transition-all duration-1000"
          style={{ background: `radial-gradient(circle, ${slide.accent} 0%, transparent 70%)` }}
        />
        <div 
          className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full blur-[120px] opacity-10 transition-all duration-1000"
          style={{ background: "radial-gradient(circle, #388E3C 0%, transparent 70%)" }}
        />
      </div>

      {/* Header */}
      <div className="w-full max-w-lg flex items-center justify-between relative z-20">
        <button 
          onClick={handleBack}
          className={cn("w-10 h-10 rounded-full flex items-center justify-center bg-card border border-border text-foreground transition-all active:scale-90", step === 0 && "opacity-0 pointer-events-none")}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="flex gap-2">
          {SLIDES.map((_, i) => (
            <div 
              key={i}
              className="h-1.5 rounded-full transition-all duration-500"
              style={{ 
                width: i === step ? "24px" : "8px",
                background: i === step ? "hsl(var(--primary))" : "rgba(128,128,128,0.2)",
                boxShadow: i === step ? "0 0 10px rgba(56,142,60,0.5)" : "none"
              }}
            />
          ))}
        </div>

        <button 
          onClick={handleSkip}
          className="text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Main Content */}
      <div className="w-full max-w-lg flex-1 flex flex-col items-center justify-center relative z-10">
        <div 
          className={cn(
            "w-full transition-all duration-500 transform text-center",
            isVisible 
              ? "opacity-100 translate-y-0 scale-100" 
              : `opacity-0 ${direction > 0 ? "translate-y-10 scale-95" : "-translate-y-10 scale-105"}`
          )}
        >
          {/* Illustration Container */}
          <div className="relative mb-12">
            <div 
              className="w-48 h-48 mx-auto rounded-[56px] flex items-center justify-center relative group"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--c-border)" }}
            >
              <div className="absolute inset-0 bg-primary blur-3xl opacity-10 group-hover:opacity-20 transition-opacity rounded-full" />
              <div 
                className="w-32 h-32 rounded-[40px] flex items-center justify-center relative overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${slide.accent}22, ${slide.accent}00)` }}
              >
                <Icon className="w-16 h-16 text-foreground relative z-10 drop-shadow-2xl" strokeWidth={1.5} />
              </div>
              
              {/* Decorative elements */}
              <div className="absolute -top-4 -right-4 w-12 h-12 rounded-2xl bg-[var(--c-card)] backdrop-blur-md border border-[var(--c-border)] flex items-center justify-center animate-bounce" style={{ animationDuration: '3s' }}>
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div className="absolute -bottom-2 -left-6 w-10 h-10 rounded-xl bg-primary/10 backdrop-blur-md border border-primary/20 flex items-center justify-center animate-pulse">
                <Check className="w-4 h-4 text-primary" />
              </div>
            </div>
          </div>

          <h1 
            className="text-4xl md:text-5xl font-black text-foreground mb-6 leading-tight"
            style={{ letterSpacing: "-0.03em" }}
          >
            {slide.title}
          </h1>
          <p className="text-lg text-[var(--c-text-muted)] font-medium leading-relaxed max-w-sm mx-auto">
            {slide.body}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full max-w-lg relative z-20">
        <button
          onClick={handleNext}
          className="w-full h-18 rounded-[28px] flex items-center justify-center text-primary-foreground font-black text-lg transition-all active:scale-[0.98] group overflow-hidden relative"
          style={{ 
            background: "hsl(var(--primary))",
            boxShadow: "0 20px 40px -10px rgba(56,142,60,0.4)"
          }}
        >
          <div className="absolute inset-0 bg-background/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
          <span className="relative z-10 flex items-center gap-3">
            {isLast ? "Begin Journey" : "Continue"}
            <ArrowRight className={cn("w-5 h-5 transition-transform duration-300", !isLast && "group-hover:translate-x-1")} />
          </span>
        </button>
        
        <p className="text-center mt-6 text-[0.625rem] uppercase tracking-[0.3em] font-black text-muted-foreground/40">
          Step {step + 1} of {SLIDES.length} • Yrdly Resident Portal
        </p>
      </div>
    </div>
  );
}
