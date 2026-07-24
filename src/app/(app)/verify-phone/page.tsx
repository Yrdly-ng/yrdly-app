"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Phone, Shield } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";

const GREEN = "hsl(var(--primary))";
const SURFACE = "var(--c-card)";
const BG = "var(--c-bg)";
const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-raleway)";

export default function VerifyPhonePage() {
  const router = useRouter();
  const { sendPhoneOtp } = useAuth();
  const { toast } = useToast();
  
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  const formatPhoneNumber = (val: string) => {
    let clean = val.replace(/\D/g, "");
    if (clean.startsWith("234")) {
      clean = "0" + clean.slice(3);
    }
    return clean;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneNumber(e.target.value));
  };

  const handleNext = async () => {
    if (phone.length < 10) {
      toast({
        title: "Invalid Phone",
        description: "Please enter a valid Nigerian phone number.",
        variant: "destructive"
      });
      return;
    }

    let finalPhone = phone;
    if (finalPhone.startsWith("0")) {
      finalPhone = "234" + finalPhone.slice(1);
    } else if (!finalPhone.startsWith("234")) {
      finalPhone = "234" + finalPhone;
    }

    setLoading(true);
    try {
      const { pinId, error } = await sendPhoneOtp(finalPhone);
      
      if (error || !pinId) {
        throw new Error(error || "Failed to send OTP");
      }

      router.push(`/verify-phone-otp?pinId=${pinId}&phone=${finalPhone}`);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to send OTP. Try again later.",
        variant: "destructive"
      });
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
          <Shield className="w-8 h-8 text-primary-light" />
        </div>
        
        <h1 className="text-3xl font-extrabold text-foreground text-center mb-3" style={{ fontFamily: RALEWAY }}>
          What&apos;s your number?
        </h1>
        <p className="text-center text-sm mb-10 px-4 leading-relaxed" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
          We&apos;ll send you a secure one-time passcode to verify this device.
        </p>

        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 flex items-center gap-3">
            <Phone className="w-5 h-5 text-primary-light" />
            <span className="font-bold text-foreground text-lg border-r pr-3" style={{ borderColor: "var(--c-border)", fontFamily: FONT }}>
              +234
            </span>
          </div>
          <input
            type="tel"
            value={phone}
            onChange={handleChange}
            placeholder="801 234 5678"
            maxLength={11}
            className="w-full h-16 pl-[110px] pr-4 rounded-[11px] text-lg font-bold bg-transparent outline-none transition-all placeholder:text-muted-foreground/50"
            style={{ 
              background: SURFACE, 
              border: "2px solid rgba(130,219,126,0.3)", 
              color: "var(--c-text)",
              fontFamily: FONT
            }}
            onFocus={(e) => (e.target.style.borderColor = GREEN)}
            onBlur={(e) => (e.target.style.borderColor = "rgba(130,219,126,0.3)")}
          />
        </div>

        <button
          onClick={handleNext}
          disabled={loading || phone.length < 10}
          className="w-full h-16 rounded-[11px] font-bold text-lg mt-8 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center"
          style={{ 
            background: GREEN, 
            color: "#fff", 
            fontFamily: FONT,
            boxShadow: phone.length >= 10 ? "0 8px 25px rgba(56,142,60,0.3)" : "none"
          }}
        >
          {loading ? "Sending Code..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
