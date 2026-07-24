"use client";

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useOnboarding } from '@/hooks/use-onboarding';
import { useAuth } from '@/hooks/use-supabase-auth';

interface OnboardingGuardProps {
  children: React.ReactNode;
}

export function OnboardingGuard({ children }: OnboardingGuardProps) {
  const { user, profile, loading } = useAuth();
  const { currentStep, isOnboardingComplete } = useOnboarding();
  const router = useRouter();
  const pathname = usePathname();
  const redirectInitiated = useRef(false);

  useEffect(() => {
    if (loading || !user || !profile) {
      redirectInitiated.current = false;
      return;
    }

    if (isOnboardingComplete) {
      redirectInitiated.current = false;
      return;
    }

    const redirectPath = (() => {
      switch (currentStep) {
        case 'email_verification': return '/onboarding/verify-email';
        case 'profile_setup':     return '/onboarding/profile';
        case 'welcome':           return '/onboarding/welcome';
        case 'tour':              return '/onboarding/tour';
        case 'signup':            return '/login';
        default:                  return '/home';
      }
    })();

    // Already on the correct onboarding page
    if (pathname === redirectPath) {
      redirectInitiated.current = false;
      return;
    }

    if (redirectInitiated.current) return;

    // Use replace() so the back button does not return user to locked page
    redirectInitiated.current = true;
    router.replace(redirectPath);
  }, [currentStep, isOnboardingComplete, user, profile, loading, router, pathname]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]" style={{ background: "var(--c-bg)" }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "hsl(var(--primary))" }} />
      </div>
    );
  }

  if (!user || !profile) return <>{children}</>;

  if (!isOnboardingComplete) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]" style={{ background: "var(--c-bg)" }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "hsl(var(--primary))" }} />
      </div>
    );
  }

  return <>{children}</>;
}
