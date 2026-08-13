"use client";

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SceneBg, GlassCard, PrimaryBtn, BackBtn } from '@/components/onboarding/primitives';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-supabase-auth';

function VerifyPhoneOtpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') || '';
  const initialPinId = searchParams.get('pinId') || '';
  
  const [pinId, setPinId] = useState(initialPinId);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(45);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { verifyPhoneOtp, sendPhoneOtp } = useAuth();
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

  const handleVerify = async () => {
    if (digits.some(d => d === '') || loading) return;
    
    setLoading(true);
    setError('');
    
    try {
      const otp = digits.join('');
      const { verified, error: verifyError } = await verifyPhoneOtp(pinId, otp);
      
      if (verifyError) {
        setError(verifyError);
        setDigits(['', '', '', '', '', '']); // Clear input on error
        inputRefs.current[0]?.focus();
      } else if (verified) {
        router.push('/onboarding/profile');
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed');
      setDigits(['', '', '', '', '', '']); // Clear input on error
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || loading) return;
    
    setLoading(true);
    setError('');
    
    try {
      const fullPhone = `+234${phone}`;
      const { pinId: newPinId, error: resendError } = await sendPhoneOtp(fullPhone);
      
      if (resendError) {
        setError(resendError);
      } else if (newPinId) {
        setPinId(newPinId);
        setCountdown(45); // Reset countdown
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  const filled = digits.every(d => d !== '');

  useEffect(() => {
    if (filled && !loading && !error) {
      handleVerify();
    }
  }, [filled]);

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
                disabled={loading}
                className={`w-12 h-14 text-center text-xl font-bold rounded-[14px] border transition-all focus:outline-none ${
                  d ? 'bg-[#82DB7E]/10 border-[#82DB7E]/50 text-white' : 'bg-white/[0.055] border-white/10 text-white'
                } ${loading ? 'opacity-50' : ''}`}
              />
            ))}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 mb-2 rounded-2xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <PrimaryBtn
            label={loading ? "Verifying..." : "Verify & Continue"}
            onClick={handleVerify}
            disabled={!filled || loading}
          />

          <div className="flex items-center justify-between text-xs text-white/38 pt-2">
            <span>Didn&apos;t receive SMS?</span>
            <button
              type="button"
              onClick={handleResend}
              disabled={countdown > 0 || loading}
              className={`font-semibold transition-colors ${countdown > 0 || loading ? 'text-white/38 cursor-not-allowed' : 'text-[#82DB7E] hover:underline'}`}
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
