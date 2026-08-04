"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SceneBg, ProgressPills, PrimaryBtn } from '@/components/onboarding/primitives';
import { useAuth } from '@/hooks/use-supabase-auth';

const SLIDES = [
  {
    headline: 'Welcome to Your\nNeighbourhood',
    description: 'Stay connected with the people, places, and conversations that make your neighbourhood feel like home.',
    imageId: '1752622176337-5d9315e2df6e',
    cta: 'Continue',
  },
  {
    headline: 'Everything You Need,\nClose to Home',
    description: 'Discover trusted neighbours, support local businesses, and find great deals just around the corner.',
    imageId: '1579998120708-682dd8a5624f',
    cta: 'Continue',
  },
  {
    headline: "Something's Always\nHappening Nearby",
    description: "From community gatherings to weekend markets, there's always something worth showing up for.",
    imageId: '1673280401347-309363111070',
    cta: 'Continue',
  },
  {
    headline: 'Meet the People\nAround You',
    description: 'Build meaningful relationships with the people who live, work and create around you.',
    imageId: '1758525225816-8dd1901ef6ec',
    cta: 'Welcome Home',
  },
];

export default function TourPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [idx, setIdx] = useState(0);
  const currentSlide = SLIDES[idx];
  const isLast = idx === SLIDES.length - 1;

  const handleDestination = () => {
    if (user) {
      if (profile?.profile_completed) router.replace('/home');
      else router.replace('/onboarding/profile');
    } else {
      router.push('/login');
    }
  };

  const advance = () => {
    if (!isLast) {
      setIdx(prev => prev + 1);
    } else {
      handleDestination();
    }
  };

  return (
    <div className="min-h-[100dvh] relative flex flex-col justify-between overflow-hidden bg-[#050505] font-sans">
      <SceneBg photoId={currentSlide.imageId} gradientStart="40%" />

      {/* Top Bar */}
      <div className="relative z-10 p-6 flex items-center justify-between max-w-md w-full mx-auto pt-8">
        <ProgressPills total={SLIDES.length} current={idx} />
        {!isLast && (
          <button
            type="button"
            onClick={handleDestination}
            className="px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-bold text-white hover:bg-white/20 transition-all shadow-md"
          >
            Skip
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* Content Box */}
      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex flex-col gap-4 pb-8">
        <h1 className="text-3xl font-extrabold text-white leading-tight whitespace-pre-line tracking-tight">
          {currentSlide.headline}
        </h1>
        <p className="text-sm text-white/55 leading-relaxed font-normal">
          {currentSlide.description}
        </p>
        <div className="pt-2">
          <PrimaryBtn label={currentSlide.cta} onClick={advance} />
        </div>
      </div>
    </div>
  );
}
