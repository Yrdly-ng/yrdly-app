"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo, SceneBg, PrimaryBtn, SecondaryBtn } from '@/components/onboarding/primitives';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useOnboarding } from '@/hooks/use-onboarding';

export default function WelcomePage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const { completeWelcome } = useOnboarding();
  const [mounted, setMounted] = useState(false);
  const [isProceeding, setIsProceeding] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleGetStarted = async () => {
    setIsProceeding(true);
    try {
      await completeWelcome();
      router.push('/onboarding/tour');
    } catch (e) {
      console.error(e);
      setIsProceeding(false);
    }
  };

  return (
    <div className="min-h-[100dvh] relative flex flex-col justify-between overflow-hidden bg-[#050505] font-sans">
      <SceneBg photoId="1594538756542-8c88bda491c5" pos="center 40%" gradientStart="30%" />
      
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className={`flex flex-col items-center gap-4 transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <Logo size={88} />
          <h1 className="text-3xl font-extrabold text-white tracking-[0.05em]">YRDLY</h1>
          <p className="text-base text-white/50 tracking-wide max-w-sm">Your Neighbourhood, Connected.</p>
        </div>
      </div>

      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex flex-col gap-3 pb-8">
        <PrimaryBtn label="Get Started" onClick={handleGetStarted} loading={isProceeding} />
        <SecondaryBtn label="Already have an account? Sign in" onClick={() => router.push('/login')} />
      </div>
    </div>
  );
}
