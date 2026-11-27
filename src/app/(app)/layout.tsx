"use client";

import Script from 'next/script';

import { Suspense, useEffect, useState } from 'react';
import { NotificationRouteGuard } from '@/components/notifications/NotificationRouteGuard';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { PushNotificationManager } from '@/components/notifications/PushNotificationManager';
import Image from 'next/image';
import { UserProfileDialog } from '@/components/profile/UserProfileDialog';
import type { User } from '@/types';
import { ServiceWorkerRegistration } from '@/components/providers/ServiceWorkerRegistration';
import { OfflineStatus } from '@/components/providers/OfflineStatus';
import { OnboardingGuard } from '@/components/onboarding/OnboardingGuard';
import { MainLayout } from '@/components/layout/MainLayout';
import { useActivityTracking } from '@/hooks/use-activity-tracking';
import { PullToRefresh } from '@/components/PullToRefresh';
import { FriendshipProvider } from '@/contexts/FriendshipContext';
import { LocationProvider } from '@/contexts/LocationContext';

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth(); // Using Supabase auth
  const router = useRouter();
  const pathname = usePathname();
  const [profileUser, setProfileUser] = useState<User | null>(null);

  // Initialize activity tracking
  useActivityTracking();


  const isPublicProfile = /^\/profile\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(pathname);

  useEffect(() => {
    if (!loading && !user && !isPublicProfile) {
      const next = typeof window === 'undefined' ? pathname : `${pathname}${window.location.search}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [user, loading, router, pathname, isPublicProfile]);

  // Only block on the auth check itself (user), not on profile.
  // Profile is allowed to arrive after first paint so the app shell
  // (Topbar, nav, page skeletons) doesn't sit behind a blank screen
  // waiting on a second/third sequential fetch.
  if (loading || (!user && !isPublicProfile)) {
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

  // Shared profile pages remain readable without an authenticated session.
  if (!user && isPublicProfile) return <>{children}</>;

  const handleProfileClick = () => {
    if (profile) setProfileUser(profile as User);
  };

  return (
    <OnboardingGuard>
      <ServiceWorkerRegistration />
      <PullToRefresh>
        <MainLayout>
          <Suspense fallback={<div role="status">Opening notification…</div>}>
            <NotificationRouteGuard>{children}</NotificationRouteGuard>
          </Suspense>
        </MainLayout>
      </PullToRefresh>
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
      <LocationProvider>
        <Script
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7576498244677518"
          strategy="afterInteractive"
          crossOrigin="anonymous"
        />
        <ProtectedLayout>
          {children}
        </ProtectedLayout>
      </LocationProvider>
    </FriendshipProvider>
  );
}
