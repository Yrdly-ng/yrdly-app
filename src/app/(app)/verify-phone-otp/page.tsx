"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";

const GREEN = "hsl(var(--primary))";
const SURFACE = "var(--c-card)";
const BG = "var(--c-bg)";
const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-raleway)";

export default function VerifyPhoneOtpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyPhoneOtp } = useAuth();
  const { toast } = useToast();
  
  const pinId = searchParams.get("pinId");
  const phone = searchParams.get("phone");

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!pinId) {
      toast({
        title: "Error",
        description: "Missing verification session. Please try again.",
        variant: "destructive"
      });
      router.replace("/verify-phone");
    }
  }, [pinId, router, toast]);

  const handleDigitChange = (val: string, index: number) => {
    if (!/^\d*$/.test(val)) return;

    if (val.length > 1) {
      // Handle paste
      const pasted = val.slice(0, 6).split("");
      const newOtp = [...otp];
      pasted.forEach((char, i) => {
        if (index + i < 6) newOtp[index + i] = char;
      });
      setOtp(newOtp);
      
      const nextIndex = Math.min(index + pasted.length, 5);
      inputRefs.current[nextIndex]?.focus();
      
      if (newOtp.every(d => d !== "")) {
        verifyOtp(newOtp.join(""));
      }
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = val;
    setOtp(newOtp);

    if (val && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newOtp.every(d => d !== "")) {
      verifyOtp(newOtp.join(""));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const verifyOtp = async (code: string) => {
    if (!pinId) return;
    
    setLoading(true);
    try {
      const { verified, error } = await verifyPhoneOtp(pinId, code);
      
      if (error || !verified) {
        throw new Error(error || "Invalid or expired code.");
      }

      toast({
        title: "Verified!",
        description: "Your phone number has been verified successfully.",
      });
      
      // Go back to profile
      router.push("/profile");
    } catch (err: any) {
      toast({
        title: "Verification Failed",
        description: err.message || "Invalid or expired code. Please try again.",
        variant: "destructive"
      });
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-4 pt-8 max-w-md mx-auto" style={{ background: BG }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <button 
          onClick={() => router.back()} 
          className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
          style={{ background: SURFACE, border: "1px solid rgba(130,219,126,0.2)" }}
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <p className="font-bold uppercase tracking-widest text-xs" style={{ fontFamily: FONT, color: "var(--c-text-muted)" }}>
          Verification
        </p>
        <div className="w-10 h-10" />
      </div>

      <div className="flex-1 flex flex-col pt-10">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto" style={{ background: "rgba(130,219,126,0.15)" }}>
          <CheckCircle2 className="w-8 h-8 text-primary-light" />
        </div>
        
        <h1 className="text-3xl font-extrabold text-foreground text-center mb-3" style={{ fontFamily: RALEWAY }}>
          Enter Code
        </h1>
        <p className="text-center text-sm mb-10 px-4 leading-relaxed" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
          We sent a 6-digit code to <br/>
          <span className="font-bold text-foreground">+{phone || "your number"}</span>
        </p>

        <div className="flex justify-between gap-2 mb-8 px-2">
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={digit}
              onChange={e => handleDigitChange(e.target.value, i)}
              onKeyDown={e => handleKeyDown(e, i)}
              className="w-12 h-16 sm:w-14 sm:h-16 rounded-[11px] text-center text-2xl font-bold bg-transparent outline-none transition-all"
              style={{ 
                background: SURFACE, 
                border: "2px solid rgba(130,219,126,0.3)", 
                color: "var(--c-text)",
                fontFamily: FONT
              }}
              onFocus={(e) => (e.target.style.borderColor = GREEN)}
              onBlur={(e) => (e.target.style.borderColor = "rgba(130,219,126,0.3)")}
            />
          ))}
        </div>

        <button
          onClick={() => verifyOtp(otp.join(""))}
          disabled={loading || otp.join("").length < 6}
          className="w-full h-16 rounded-[11px] font-bold text-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center"
          style={{ 
            background: GREEN, 
            color: "#fff", 
            fontFamily: FONT,
            boxShadow: otp.join("").length === 6 ? "0 8px 25px rgba(56,142,60,0.3)" : "none"
          }}
        >
          {loading ? "Verifying..." : "Verify"}
        </button>
      </div>
    </div>
  );
}
