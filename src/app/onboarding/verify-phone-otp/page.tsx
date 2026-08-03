"use client";

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SceneBg, GlassCard, PrimaryBtn, BackBtn } from '@/components/onboarding/primitives';

function VerifyPhoneOtpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') || '';
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(45);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleDigit = (i: number, val: string) => {
    const clean = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) {
      inputRefs.current[i + 1]?.focus();
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  };

  const handleVerify = () => {
    router.push('/onboarding/profile');
  };

  const filled = digits.every(d => d !== '');

  useEffect(() => {
    if (filled) {
      handleVerify();
    }
  }, [digits]);

  return (
    <div className="min-h-[100dvh] relative flex flex-col justify-between overflow-y-auto bg-[#050505] font-sans pb-10">
      <SceneBg photoId="1654762550505-7c58277e0fac" pos="center 30%" gradientStart="40%" />

      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex items-center justify-between pt-8">
        <BackBtn onClick={() => router.back()} light />
      </div>

      <div className="relative z-10 p-6 max-w-md w-full mx-auto my-auto">
        <GlassCard>
          <div className="flex flex-col gap-1 text-left">
            <h2 className="text-2xl font-black text-white">Enter SMS code</h2>
            <p className="text-sm font-normal text-white/55">
              We sent a 6-digit code via SMS to{' '}
              <span className="text-white/80 font-medium">{phone ? `+234 ${phone}` : 'your phone number'}</span>
            </p>
          </div>

          {/* OTP Digit Boxes */}
          <div className="flex gap-2 justify-center my-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={e => handleDigit(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                className={`w-12 h-14 text-center text-xl font-bold rounded-[14px] border transition-all focus:outline-none ${
                  d ? 'bg-[#82DB7E]/10 border-[#82DB7E]/50 text-white' : 'bg-white/[0.055] border-white/10 text-white'
                }`}
              />
            ))}
          </div>

          <PrimaryBtn
            label="Verify & Continue"
            onClick={handleVerify}
            disabled={!filled}
          />

          <div className="flex items-center justify-between text-xs text-white/38 pt-2">
            <span>Didn&apos;t receive SMS?</span>
            <button
              type="button"
              onClick={countdown === 0 ? () => setCountdown(45) : undefined}
              disabled={countdown > 0}
              className={`font-semibold transition-colors ${countdown > 0 ? 'text-white/38 cursor-not-allowed' : 'text-[#82DB7E] hover:underline'}`}
            >
              {countdown > 0 ? `Resend SMS in 0:${String(countdown).padStart(2, '0')}` : 'Resend Code'}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

export default function VerifyPhoneOtpPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[100dvh] bg-[#050505]" />}>
      <VerifyPhoneOtpContent />
    </React.Suspense>
  );
}
