"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SceneBg, GlassCard, GlassInput, PrimaryBtn, BackBtn } from '@/components/onboarding/primitives';
import { ShieldCheck, ChevronDown, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-supabase-auth';

export default function VerifyPhonePage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { sendPhoneOtp } = useAuth();

  const handleSendOtp = async () => {
    if (phone.length < 10) return;
    
    setLoading(true);
    setError('');
    
    try {
      const fullPhone = `+234${phone}`;
      const { pinId, error: otpError } = await sendPhoneOtp(fullPhone);
      
      if (otpError) {
        setError(otpError);
      } else if (pinId) {
        router.push(`/onboarding/verify-phone-otp?phone=${encodeURIComponent(phone)}&pinId=${encodeURIComponent(pinId)}`);
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] relative flex flex-col justify-between overflow-y-auto bg-[#050505] font-sans pb-10">
      <SceneBg photoId="1654762550505-7c58277e0fac" pos="center 35%" gradientStart="40%" />

      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex items-center justify-between pt-8">
        <BackBtn onClick={() => router.back()} light />
        <button
          type="button"
          onClick={() => router.push('/onboarding/profile?phoneSkipped=true')}
          className="px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-bold text-white hover:bg-white/20 transition-all shadow-md"
        >
          Skip for now
        </button>
      </div>

      <div className="relative z-10 p-6 max-w-md w-full mx-auto my-auto">
        <GlassCard>
          <div className="flex flex-col gap-1 text-left">
            <h2 className="text-2xl font-black text-white">Verify your phone number</h2>
            <p className="text-sm font-normal text-white/55">
              YRDLY is a verified community. We use your number to keep buyers and sellers safe in your neighbourhood.
            </p>
          </div>

          {/* Phone Field Row */}
          <div className="flex gap-2 items-center">
            <div className="flex items-center gap-1.5 px-3 h-14 rounded-[18px] bg-white/[0.055] border border-white/10 text-white text-sm font-semibold">
              <span className="text-base">🇳🇬</span>
              <span>+234</span>
              <ChevronDown className="w-3 h-3 text-white/38" />
            </div>

            <div className="flex-1">
              <GlassInput
                placeholder="801 234 5678"
                value={phone}
                onChange={v => setPhone(v.replace(/\D/g, '').slice(0, 10))}
                maxLength={10}
              />
            </div>
          </div>

          {/* Trust Badge */}
          <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-[#82DB7E]/10 border border-[#82DB7E]/20 text-xs text-[#82DB7E]">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Your number is never shared publicly with other users.</span>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 mt-2 rounded-2xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <PrimaryBtn
            label={loading ? "Sending..." : "Send Verification Code"}
            onClick={handleSendOtp}
            disabled={phone.length < 10 || loading}
          />
        </GlassCard>
      </div>
    </div>
  );
}
