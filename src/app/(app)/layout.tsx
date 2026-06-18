
"use client";

import Script from 'next/script';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { PushNotificationManager } from '@/components/PushNotificationManager';
import Image from 'next/image';
import { APIProvider } from '@vis.gl/react-google-maps';
import { UserProfileDialog } from '@/components/UserProfileDialog';
import type { User } from '@/types';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { OfflineStatus } from '@/components/OfflineStatus';
import { OnboardingGuard } from '@/components/OnboardingGuard';
import { MainLayout } from '@/components/layout/MainLayout';
import { useActivityTracking } from '@/hooks/use-activity-tracking';
import { setUserContext, clearUserContext, trackUserAction } from '@/lib/sentry';
import { FriendshipProvider } from '@/contexts/FriendshipContext';
import { LocationProvider } from '@/contexts/LocationContext';

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth(); // Using Supabase auth
  const router = useRouter();
  const [profileUser, setProfileUser] = useState<User | null>(null);
  
  // Initialize activity tracking
  useActivityTracking();

  // Set user context for Sentry
  useEffect(() => {
    if (user && profile) {
      setUserContext({
        id: user.id,
        email: user.email,
        name: profile.name,
        avatar_url: profile.avatar_url,
      });
      
      // Track user login
      trackUserAction('user_logged_in', {
        userId: user.id,
        userEmail: user.email,
      });
    } else if (!loading && !user) {
      // Clear user context on logout
      clearUserContext();
      trackUserAction('user_logged_out');
    }
  }, [user, profile, loading]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading || !user || !profile) {
    return (
      <div className="flex h-[100dvh] w-screen items-center justify-center bg-background">
        <Image 
            src="/logo.png" 
            alt="Yrdly Logo" 
            width={96} 
            height={96} 
            className="animate-pulse w-24 h-24"
            priority
        />
      </div>
    );
  }

  const handleProfileClick = () => {
    setProfileUser(profile as User);
  };

  return (
    <OnboardingGuard>
      <ServiceWorkerRegistration />
      <PushNotificationManager />
      <MainLayout>
        {children}
      </MainLayout>
      {/* Offline Status Component */}
      <OfflineStatus />
    </OnboardingGuard>
  );
}


export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FriendshipProvider>
      <Script
        src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7576498244677518"
        strategy="afterInteractive"
        crossOrigin="anonymous"
      />
      <LocationProvider>
        <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!} libraries={['places']}>
          <ProtectedLayout>
            {children}
          </ProtectedLayout>
        </APIProvider>
      </LocationProvider>
    </FriendshipProvider>
  );
}
