"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SceneBg, GlassCard, GlassInput, PrimaryBtn, BackBtn } from '@/components/onboarding/primitives';
import { ShieldCheck, ChevronDown } from 'lucide-react';

export default function VerifyPhonePage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');

  return (
    <div className="min-h-[100dvh] relative flex flex-col justify-between overflow-y-auto bg-[#050505] font-sans pb-10">
      <SceneBg photoId="1654762550505-7c58277e0fac" pos="center 35%" gradientStart="40%" />

      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex items-center justify-between pt-8">
        <BackBtn onClick={() => router.back()} light />
        <button
          type="button"
          onClick={() => router.push('/onboarding/profile?phoneSkipped=true')}
          className="text-sm font-medium text-white/38 hover:text-white transition-colors"
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

          <PrimaryBtn
            label="Send Verification Code"
            onClick={() => router.push(`/onboarding/verify-phone-otp?phone=${encodeURIComponent(phone)}`)}
            disabled={phone.length < 10}
          />
        </GlassCard>
      </div>
    </div>
  );
}
