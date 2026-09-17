"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import Splash from './splash/page';

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace('/home');
      } else {
        router.replace('/login');
      }
    }
  }, [user, loading, router]);

  // While loading, show the splash screen.
  // After loading, the useEffect will redirect.
  // This prevents a flash of the login page before redirection.
  if (loading) {
    return <Splash />;
  }

  // This will be shown briefly before redirection if not loading.
  // It can be a splash screen or a blank page.
  return <Splash />;
}
