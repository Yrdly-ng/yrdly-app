"use client";

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SceneBg, GlassCard, PrimaryBtn, BackBtn } from '@/components/onboarding/primitives';
import { supabase } from '@/lib/supabase';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(45);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
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

  const filled = digits.every(d => d !== '');

  const handleVerifyOtp = async () => {
    const token = digits.join('');
    if (token.length < 6) return;

    setError('');
    setVerifying(true);

    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'signup',
      });

      setVerifying(false);

      if (err) {
        setError(err.message || 'Invalid verification code');
      } else {
        router.push('/onboarding/verify-phone');
      }
    } catch (e: any) {
      setVerifying(false);
      setError(e.message || 'Verification failed');
    }
  };

  useEffect(() => {
    if (filled && !verifying) {
      handleVerifyOtp();
    }
  }, [digits]);

  const handleResend = async () => {
    if (!email) return;
    setCountdown(45);
    await supabase.auth.resend({
      type: 'signup',
      email,
    });
  };

  return (
    <div className="min-h-[100dvh] relative flex flex-col justify-between overflow-y-auto bg-[#050505] font-sans pb-10">
      <SceneBg photoId="1768244016593-8ca75b15bc92" pos="center 25%" gradientStart="42%" />

      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex items-center justify-between pt-8">
        <BackBtn onClick={() => router.back()} light />
      </div>

      <div className="relative z-10 p-6 max-w-md w-full mx-auto my-auto">
        <GlassCard>
          <div className="flex flex-col gap-1 text-left">
            <h2 className="text-2xl font-black text-white">Check your email</h2>
            <p className="text-sm font-normal text-white/55">
              We sent a 6-digit verification code to{' '}
              <span className="text-white/80 font-medium">{email || 'your email address'}</span>
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
              {error}
            </div>
          )}

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
            onClick={handleVerifyOtp}
            disabled={!filled}
            loading={verifying}
          />

          <div className="flex items-center justify-between text-xs text-white/38 pt-2">
            <span>Didn&apos;t receive code?</span>
            <button
              type="button"
              onClick={countdown === 0 ? handleResend : undefined}
              disabled={countdown > 0}
              className={`font-semibold transition-colors ${countdown > 0 ? 'text-white/38 cursor-not-allowed' : 'text-[#82DB7E] hover:underline'}`}
            >
              {countdown > 0 ? `Resend code in 0:${String(countdown).padStart(2, '0')}` : 'Resend Code'}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[100dvh] bg-[#050505]" />}>
      <VerifyEmailContent />
    </React.Suspense>
  );
}
