"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2, Lock, Eye, EyeOff, CheckCircle2, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const searchErr = searchParams.get("error_description");
    let hashErr = null;

    if (hash && hash.includes("error_description=")) {
      try {
        const raw = hash.split("error_description=")[1].split("&")[0];
        hashErr = decodeURIComponent(raw.replace(/\+/g, " "));
      } catch {}
    }

    const detectedError = searchErr || hashErr;
    if (detectedError) {
      setError(detectedError);
      return;
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "PASSWORD_RECOVERY") {
        if (!session) {
          router.replace("/login");
        }
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateError.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push("/login");
        }, 2500);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
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
            Create a new password for your{" "}
            <span className="bg-gradient-to-r from-[#FFD600] via-[#82DB7E] to-[#00D078] bg-clip-text text-transparent">
              neighbourhood.
            </span>
          </h1>

          <div className="relative w-72 h-72 flex items-center justify-center pt-4">
            <div className="relative w-56 h-64 rounded-3xl bg-[#14171d] border border-[#82DB7E]/30 p-5 shadow-2xl z-20 flex flex-col justify-between text-left">
              <div className="w-10 h-10 rounded-2xl bg-[#82DB7E]/20 border border-[#82DB7E] flex items-center justify-center text-[#82DB7E]">
                <Lock className="w-5 h-5" />
              </div>
              <div className="space-y-1.5 my-auto">
                <h4 className="text-sm font-bold text-white font-yrdly-display">
                  Secure Password Update
                </h4>
                <p className="text-xs text-[var(--yrdly-label)] leading-relaxed">
                  Choose a new strong password to protect your YRDLY account.
                </p>
              </div>
              <div className="text-[10px] text-white/30 font-mono">
                Encrypted & Safe
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
              onClick={() => router.push("/login")}
              className="flex items-center gap-1.5 text-xs font-bold text-white/70 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Login</span>
            </button>
            <span className="lg:hidden font-yrdly-display font-black text-2xl text-[#82DB7E]">
              YRDLY
            </span>
          </div>

          {/* Form Container */}
          <div className="my-auto py-8 space-y-5 max-w-[360px] w-full mx-auto">
            <div className="space-y-1 text-center sm:text-left">
              <h2 className="text-2xl font-bold font-yrdly-display text-white tracking-tight">
                Set New Password
              </h2>
              <p className="text-xs text-zinc-400">
                Create a new strong password for your account
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold leading-snug">
                {error}
              </div>
            )}

            {success ? (
              <div className="space-y-4 text-left bg-emerald-950/40 border border-[#82DB7E]/30 p-5 rounded-2xl">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-[#82DB7E] shrink-0" />
                  <div>
                    <h4 className="text-sm font-bold text-white font-yrdly-display">
                      Password Updated!
                    </h4>
                    <p className="text-xs text-white/70 mt-0.5">
                      Your password has been changed successfully. Redirecting to login...
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => router.push("/login")}
                  className="w-full h-[46px] rounded-xl bg-[#82DB7E] text-black font-extrabold text-sm hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center"
                >
                  Log in Now
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                {/* New Password */}
                <div className="relative w-full flex items-center">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="New Password (8+ chars)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-[50px] pl-4 pr-11 rounded-xl bg-[#121214] border border-white/20 focus:border-white/50 focus:bg-[#18181b] outline-none text-sm text-white placeholder:text-zinc-500 font-yrdly-body transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 text-zinc-400 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Confirm Password */}
                <div className="relative w-full">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm New Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full h-[50px] px-4 rounded-xl bg-[#121214] border border-white/20 focus:border-white/50 focus:bg-[#18181b] outline-none text-sm text-white placeholder:text-zinc-500 font-yrdly-body transition-all"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[46px] rounded-xl bg-[#82DB7E] text-black font-extrabold text-sm hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center shadow-lg shadow-[#82DB7E]/10"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-black" />
                  ) : (
                    "Update Password"
                  )}
                </button>

                <div className="text-center pt-2">
                  <Link
                    href="/login"
                    className="text-xs text-white/60 hover:text-white transition-colors font-medium"
                  >
                    Cancel and <span className="text-[#82DB7E] font-bold">Log in</span>
                  </Link>
                </div>
              </form>
            )}
          </div>

          <div className="pt-6 text-center text-[11px] font-bold tracking-widest text-white/20 uppercase font-mono">
            YRDLY
          </div>
        </div>
      </div>
    </div>
  );
}
