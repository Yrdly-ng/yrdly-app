'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { googleTagManagerEnabled } from '@/lib/attribution/google-measurement';
import { recoverGoogleListings } from '@/lib/attribution/pending-listing-measurement';

export function PendingListingMeasurements() {
  const { user } = useAuth();
  const owner = user?.id;
  useEffect(() => {
    if (!googleTagManagerEnabled || !owner) return;
    let current = true;
    let running = false;
    const recover = async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try { await recoverGoogleListings(owner, () => current); }
      finally { running = false; }
    };
    void recover();
    const timer = window.setInterval(() => { void recover(); }, 60_000);
    const onVisible = () => { void recover(); };
    window.addEventListener('focus', onVisible);
    window.addEventListener('yrdly:cookie-consent', onVisible);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('yrdly:cookie-consent', onVisible);
    };
  }, [owner]);
  return null;
}
