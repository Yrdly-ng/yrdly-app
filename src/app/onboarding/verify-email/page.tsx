"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { Loader2, Mail, RefreshCw, ArrowLeft, CheckCircle2 } from "lucide-react";
import { YrdlyLogo } from "@/components/ui/yrdly-logo";
import { useToast } from "@/hooks/use-toast";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const { toast } = useToast();

  const email = searchParams.get("email") || user?.email || "";

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect unauthenticated users (no session at all) back to login
  useEffect(() => {
    if (!loading && !user && !email) {
      router.replace("/login");
    }
  }, [loading, user, email, router]);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Auto-focus first box on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const joinedOtp = otp.join("");
  const isFilled = joinedOtp.length === OTP_LENGTH;

  /* ── OTP input handlers ── */
  const handleChange = (index: number, value: string) => {
    // Allow only digits
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    setError(null);

    // Advance focus
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when last digit entered
    if (digit && index === OTP_LENGTH - 1) {
      const token = next.join("");
      if (token.length === OTP_LENGTH) handleVerify(token);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (otp[index]) {
        const next = [...otp];
        next[index] = "";
        setOtp(next);
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = [...otp];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtp(next);
    setError(null);
    // Focus last filled box or final box
    const focusIdx = Math.min(pasted.length, OTP_LENGTH - 1);
    inputRefs.current[focusIdx]?.focus();
    // Auto-submit if full
    if (pasted.length === OTP_LENGTH) handleVerify(pasted);
  };

  /* ── Verify OTP ── */
  const handleVerify = useCallback(
    async (token: string = joinedOtp) => {
      if (token.length !== OTP_LENGTH || verifying || success) return;
      if (!email) { setError("Email address not found. Please go back and sign up again."); return; }

      setVerifying(true);
      setError(null);

      try {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email,
          token,
          type: "signup",
        });

        if (verifyError) {
          setError(
            verifyError.message.includes("expired")
              ? "This code has expired. Please request a new one."
              : verifyError.message.includes("invalid")
              ? "Incorrect code. Please check your email and try again."
              : verifyError.message
          );
          // Clear the OTP boxes so user can try again
          setOtp(Array(OTP_LENGTH).fill(""));
          inputRefs.current[0]?.focus();
          return;
        }

        // ✅ Verified!
        setSuccess(true);
        toast({ title: "Email verified!", description: "Welcome to Yrdly." });

        // Short celebration pause, then continue to profile setup
        setTimeout(() => {
          router.push("/onboarding/profile");
        }, 1200);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setVerifying(false);
      }
    },
    [joinedOtp, verifying, success, email, router, toast]
  );

  /* ── Resend OTP ── */
  const handleResend = async () => {
    if (resending || cooldown > 0 || !email) return;
    setResending(true);
    setError(null);

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
      });

      if (resendError) {
        setError(resendError.message);
      } else {
        setCooldown(RESEND_COOLDOWN);
        setOtp(Array(OTP_LENGTH).fill(""));
        inputRefs.current[0]?.focus();
        toast({
          title: "Code resent!",
          description: `A new 6-digit code was sent to ${email}`,
        });
      }
    } catch {
      setError("Failed to resend code. Please try again.");
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#388E3C" }} />
      </div>
    );
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10 overflow-x-hidden bg-background text-foreground"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[-15%] right-[-15%] w-[55%] h-[55%] rounded-full blur-[160px] opacity-15"
          style={{ background: "radial-gradient(circle, #388E3C 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-[-15%] left-[-15%] w-[55%] h-[55%] rounded-full blur-[160px] opacity-10"
          style={{ background: "radial-gradient(circle, #388E3C 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[420px] flex flex-col items-center gap-8">
        {/* Logo */}
        <div className="flex justify-center">
          <YrdlyLogo />
        </div>

        {/* Heading */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black tracking-tight text-foreground">
            Check your <span style={{ color: "#388E3C" }}>email</span>
          </h1>
          <p className="text-sm font-medium text-muted-foreground">
            We sent a 6-digit code to
          </p>
          <p
            className="text-sm font-bold px-4 py-1.5 rounded-full inline-block"
            style={{ background: "rgba(56,142,60,0.12)", color: "#388E3C", border: "1px solid rgba(56,142,60,0.25)" }}
          >
            {email || "your email"}
          </p>
        </div>

        {/* Card */}
        <div className="w-full rounded-[28px] p-8 space-y-7 bg-card border border-border shadow-2xl">
          {/* Mail icon */}
          <div className="flex justify-center">
            {success ? (
              <div
                className="w-20 h-20 rounded-[24px] flex items-center justify-center"
                style={{ background: "rgba(56,142,60,0.15)", border: "1px solid rgba(56,142,60,0.3)" }}
              >
                <CheckCircle2 className="w-10 h-10" style={{ color: "#388E3C" }} />
              </div>
            ) : (
              <div
                className="w-20 h-20 rounded-[24px] flex items-center justify-center"
                style={{ background: "rgba(56,142,60,0.08)", border: "1px solid rgba(56,142,60,0.2)" }}
              >
                <Mail className="w-10 h-10" style={{ color: "#388E3C" }} />
              </div>
            )}
          </div>

          {/* OTP Inputs */}
          <div className="flex justify-center gap-3" onPaste={handlePaste}>
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                disabled={verifying || success}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onFocus={(e) => e.target.select()}
                className="w-12 h-14 text-center text-xl font-black rounded-[14px] outline-none transition-all duration-200 disabled:opacity-50"
                style={{
                  background: digit ? "rgba(56,142,60,0.12)" : "hsl(var(--muted))",
                  border: error
                    ? "2px solid #ef4444"
                    : digit
                    ? "2px solid #388E3C"
                    : "1.5px solid hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                  caretColor: "#388E3C",
                  boxShadow: digit ? "0 0 0 3px rgba(56,142,60,0.1)" : "none",
                }}
                aria-label={`OTP digit ${i + 1}`}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <p className="text-center text-sm font-medium" style={{ color: "#ef4444" }}>
              {error}
            </p>
          )}

          {/* Success message */}
          {success && (
            <p className="text-center text-sm font-bold" style={{ color: "#388E3C" }}>
              Verified! Taking you to your profile setup…
            </p>
          )}

          {/* Verify button — shown when filled but not auto-submitted (e.g. typed manually) */}
          {isFilled && !success && (
            <button
              onClick={() => handleVerify()}
              disabled={verifying}
              className="w-full h-14 rounded-[18px] font-black text-white text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60"
              style={{ background: "#388E3C", boxShadow: "0 12px 28px -6px rgba(56,142,60,0.45)" }}
            >
              {verifying ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Verify Code
                </>
              )}
            </button>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs font-medium text-muted-foreground">
              Didn&apos;t get it?
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Resend */}
          <button
            onClick={handleResend}
            disabled={resending || cooldown > 0 || success}
            className="w-full h-12 rounded-[16px] font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 bg-transparent border-[1.5px] border-border text-muted-foreground"
          >
            {resending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </div>

        {/* Back to login */}
        <button
          onClick={() => router.push("/login")}
          className="flex items-center gap-2 text-sm font-bold transition-opacity hover:opacity-70 text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to login
        </button>

        {/* Note */}
        <p className="text-center text-xs text-muted-foreground opacity-50">
          Tip: check your spam folder if you don&apos;t see it within 2 minutes
        </p>
      </div>
    </div>
  );
}

export default function OnboardingVerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#388E3C" }} />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
