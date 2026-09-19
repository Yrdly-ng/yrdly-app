"use client";

import React, { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";

function VerifyPhoneOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get("phone") || "";
  const pinId = searchParams.get("pinId") || "";

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [countdown, setCountdown] = useState(45);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleDigit = (i: number, val: string) => {
    const clean = val.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) {
      inputRefs.current[i + 1]?.focus();
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  };

  const filled = digits.every((d) => d !== "");

  const handleVerifyOtp = async () => {
    const code = digits.join("");
    if (code.length < 6) return;

    setError("");
    setVerifying(true);

    try {
      const res = await fetch("/api/auth/verify-phone-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: `+234${phone}`, pinId, code }),
      });

      const data = await res.json();
      setVerifying(false);

      if (!res.ok || !data.success) {
        setError(data.error || "Invalid verification code");
      } else {
        router.push("/onboarding/profile");
      }
    } catch (e: any) {
      setVerifying(false);
      setError(e.message || "Verification failed");
    }
  };

  useEffect(() => {
    if (filled && !verifying) {
      handleVerifyOtp();
    }
  }, [digits]);

  return (
    <div className="min-h-[100dvh] w-full bg-[#0b0c0f] text-foreground flex flex-col lg:flex-row overflow-x-hidden font-yrdly-body select-none">
      {/* ── Left Hero Panel (Instagram Style Showcase) ── */}
      <div className="hidden lg:flex flex-1 flex-col justify-between p-12 lg:p-16 bg-[#08090b] relative overflow-hidden border-r border-white/5">
        <div className="flex items-center gap-2 z-10">
          <span className="font-yrdly-display font-black text-3xl tracking-tight text-[#82DB7E]">
            YRDLY
          </span>
        </div>

        <div className="flex flex-col items-center text-center my-auto z-10 max-w-md mx-auto space-y-8">
          <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-tight font-yrdly-display tracking-tight">
            Enter your code for a verified{" "}
            <span className="bg-gradient-to-r from-[#FFD600] via-[#82DB7E] to-[#00D078] bg-clip-text text-transparent">
              neighbourhood.
            </span>
          </h1>

          <div className="relative w-72 h-72 flex items-center justify-center pt-4">
            <div className="relative w-56 h-64 rounded-3xl bg-[#14171d] border border-[#82DB7E]/30 p-5 shadow-2xl z-20 flex flex-col justify-between text-left">
              <div className="w-10 h-10 rounded-2xl bg-[#82DB7E]/20 border border-[#82DB7E] flex items-center justify-center text-[#82DB7E]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="space-y-1.5 my-auto">
                <h4 className="text-sm font-bold text-white font-yrdly-display">
                  Phone Verification
                </h4>
                <p className="text-xs text-[var(--yrdly-label)] leading-relaxed">
                  Enter the 6-digit SMS code sent to your phone.
                </p>
              </div>
              <div className="text-[10px] text-white/30 font-mono">
                SMS Code Verification
              </div>
            </div>
          </div>
        </div>

        <div className="z-10 text-xs text-white/30 text-center font-mono">
          © {new Date().getFullYear()} YRDLY Inc.
        </div>
      </div>

      {/* ── Right Auth Panel (Instagram Style Form) ── */}
      <div
        className="flex-1 min-h-[100dvh] flex flex-col justify-between p-6 sm:p-10 lg:p-14 relative bg-cover bg-center"
        style={{ backgroundImage: "url('/images/onboarding/signup.jpg')" }}
      >
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-0" />

        <div className="relative z-10 flex-1 flex flex-col justify-between max-w-lg w-full mx-auto">
          {/* Top Header */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-xs font-bold text-white/70 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <span className="lg:hidden font-yrdly-display font-black text-2xl text-[#82DB7E]">
              YRDLY
            </span>
          </div>

          {/* Form Container */}
          <div className="my-auto py-8 space-y-6 max-w-md w-full mx-auto">
            <div className="space-y-1.5 text-left">
              <h2 className="text-2xl sm:text-3xl font-bold font-yrdly-display text-white tracking-tight">
                Enter SMS Code
              </h2>
              <p className="text-xs sm:text-sm text-white/50 leading-relaxed">
                We sent a 6-digit code to{" "}
                <span className="text-white font-semibold">+234 {phone || "your phone"}</span>
              </p>
            </div>

            {error && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold leading-snug">
                {error}
              </div>
            )}

            {/* OTP Digits Row */}
            <div className="flex gap-2 justify-between py-2">
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigit(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className="w-12 h-14 text-center text-xl font-bold font-mono rounded-xl bg-[#1c1f26] border border-white/10 text-white focus:border-[#82DB7E] focus:outline-none transition-all"
                />
              ))}
            </div>

            <button
              type="button"
              onClick={handleVerifyOtp}
              disabled={!filled || verifying}
              className="w-full h-12 rounded-xl bg-[#82DB7E] text-black font-extrabold text-sm hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center shadow-lg shadow-[#82DB7E]/10 disabled:opacity-50"
            >
              {verifying ? (
                <Loader2 className="w-5 h-5 animate-spin text-black" />
              ) : (
                "Verify Phone"
              )}
            </button>

            <div className="text-center pt-2">
              {countdown > 0 ? (
                <span className="text-xs text-white/40 font-mono">
                  Resend code in {countdown}s
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="text-xs font-bold text-[#82DB7E] hover:underline"
                >
                  Resend Code
                </button>
              )}
            </div>
          </div>

          <div className="pt-6 text-center text-[11px] font-bold tracking-widest text-white/20 uppercase font-mono">
            YRDLY
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPhoneOtpPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0b0c0f] flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-[#82DB7E] animate-spin" />
        </div>
      }
    >
      <VerifyPhoneOtpForm />
    </Suspense>
  );
}
