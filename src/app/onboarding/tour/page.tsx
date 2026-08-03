"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useOnboarding } from "@/hooks/use-onboarding";
import { onboardingAnalytics } from "@/lib/onboarding-analytics";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────
   Slide definitions
 ───────────────────────────────────────────── */
const SLIDES = [
  {
    id: "belong",
    title: "Welcome to Your\nNeighbourhood",
    body: "Stay connected with the people, places, and conversations that make your neighbourhood feel like home.",
    image: "/images/onboarding/slide1.jpg",
    cta: "Continue",
  },
  {
    id: "discover",
    title: "Everything You Need,\nClose to Home",
    body: "Discover trusted neighbours, support local businesses, and find great deals just around the corner.",
    image: "/images/onboarding/slide2.jpg",
    cta: "Continue",
  },
  {
    id: "experience",
    title: "Something's Always\nHappening Nearby",
    body: "From community gatherings to weekend markets, there's always something worth showing up for.",
    image: "/images/onboarding/slide3.jpg",
    cta: "Continue",
  },
  {
    id: "connect",
    title: "Meet the People\nAround You",
    body: "Build meaningful relationships with the people who live, work and create around you.",
    image: "/images/onboarding/slide4.jpg",
    cta: "Welcome Home",
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
        onboardingAnalytics.trackTourCompleted();
        await completeTour();
      } catch {}
      router.push("/home");
    } else {
      setDirection(1);
      setIsVisible(false);
      setTimeout(() => {
        setStep((s) => s + 1);
        setIsVisible(true);
      }, 300);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setDirection(-1);
      setIsVisible(false);
      setTimeout(() => {
        setStep((s) => s - 1);
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

  return (
    <div className="min-h-[100dvh] relative flex flex-col items-center justify-between overflow-hidden px-6 py-12 bg-background" style={{ fontFamily: "var(--font-work-sans)" }}>
      
      {/* Background Animated Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full blur-[120px] opacity-20 transition-all duration-1000"
          style={{ background: "radial-gradient(circle, #82DB7E 0%, transparent 70%)" }}
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
          {/* Image Container */}
          <div className="relative mb-8">
            <div className="w-64 h-64 mx-auto rounded-[36px] overflow-hidden relative border border-white/10 shadow-2xl">
              <Image
                src={slide.image}
                alt={slide.title}
                width={256}
                height={256}
                className="w-full h-full object-cover"
                priority
              />
            </div>
          </div>

          <h1 
            className="text-4xl md:text-5xl font-black text-foreground mb-6 leading-tight whitespace-pre-line"
            style={{ letterSpacing: "-0.03em" }}
          >
            {slide.title}
          </h1>
          <p className="text-lg text-[var(--c-text-muted)] font-medium leading-relaxed max-w-sm mx-auto">
            {slide.body}
          </p>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="w-full max-w-lg relative z-20 flex flex-col gap-4">
        <button
          onClick={handleNext}
          className="w-full h-16 rounded-[28px] bg-[#82DB7E] text-[#050505] font-black text-lg flex items-center justify-center gap-3 shadow-[0_8px_30px_rgb(130,219,126,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          <span>{slide.cta}</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

    </div>
  );
}
