"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ChevronDown, AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";

export default function VerifyPhonePage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { sendPhoneOtp } = useAuth();

  const handleSendOtp = async () => {
    if (phone.length < 10) return;

    setLoading(true);
    setError("");

    try {
      const fullPhone = `+234${phone}`;
      const { pinId, error: otpError } = await sendPhoneOtp(fullPhone);

      if (otpError) {
        setError(otpError);
      } else if (pinId) {
        router.push(
          `/onboarding/verify-phone-otp?phone=${encodeURIComponent(
            phone
          )}&pinId=${encodeURIComponent(pinId)}`
        );
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

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
            Verify your phone for a safe{" "}
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
                  Community Verification
                </h4>
                <p className="text-xs text-[var(--yrdly-label)] leading-relaxed">
                  We use your phone number to keep buyers, sellers, and neighbors safe.
                </p>
              </div>
              <div className="text-[10px] text-white/30 font-mono">
                Trusted & Encrypted
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
            <button
              type="button"
              onClick={() => router.push("/onboarding/profile?phoneSkipped=true")}
              className="text-xs font-bold text-[#82DB7E] hover:underline"
            >
              Skip for now
            </button>
          </div>

          {/* Form Container */}
          <div className="my-auto py-8 space-y-5 max-w-[360px] w-full mx-auto">
            <div className="space-y-1 text-center sm:text-left">
              <h2 className="text-2xl font-bold font-yrdly-display text-white tracking-tight">
                Verify phone number
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                YRDLY is a verified community. We use your number for trust & security.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-[#1c1214]/90 border border-red-500/35 text-red-400 text-xs font-semibold leading-snug shadow-[0_8px_25px_rgba(239,68,68,0.15)] backdrop-blur-md animate-in fade-in-0 slide-in-from-top-2 duration-200">
                <div className="w-7 h-7 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.2)]">
                  <AlertCircle className="w-4 h-4 stroke-[2.2]" />
                </div>
                <span className="flex-1 min-w-0">{error}</span>
              </div>
            )}

            {/* Phone Input Row */}
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-1.5 px-3.5 h-[50px] rounded-xl bg-[#121214] border border-white/20 text-white text-sm font-semibold shrink-0">
                <span className="text-base">🇳🇬</span>
                <span>+234</span>
                <ChevronDown className="w-3 h-3 text-white/40" />
              </div>

              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  placeholder="801 234 5678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  maxLength={10}
                  className="w-full h-[50px] px-4 rounded-xl bg-[#121214] border border-white/20 focus:border-white/50 focus:bg-[#18181b] outline-none text-sm text-white placeholder:text-zinc-500 font-yrdly-body transition-all"
                />
              </div>
            </div>

            {/* Trust Badge */}
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#82DB7E]/10 border border-[#82DB7E]/20 text-xs text-[#82DB7E]">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Your phone number is never shared publicly with other users.</span>
            </div>

            <button
              type="button"
              onClick={handleSendOtp}
              disabled={phone.length < 10 || loading}
              className="w-full h-[46px] rounded-xl bg-[#82DB7E] text-black font-extrabold text-sm hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center shadow-lg shadow-[#82DB7E]/10 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin text-black" />
              ) : (
                "Send Verification Code"
              )}
            </button>
          </div>

          <div className="pt-6 text-center text-[11px] font-bold tracking-widest text-white/20 uppercase font-mono">
            YRDLY
          </div>
        </div>
      </div>
    </div>
  );
}
