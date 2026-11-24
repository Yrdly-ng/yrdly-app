'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  googleMeasurementConsent,
  googleTagManagerEnabled,
  setGoogleMeasurementConsent,
  trackGooglePage,
} from '@/lib/attribution/google-measurement';

export function GoogleMeasurement() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!googleTagManagerEnabled || window.location.origin !== 'https://app.yrdly.ng') return;
    if (googleMeasurementConsent()) trackGooglePage(pathname);
    else setShow(!document.cookie.split(/;\s*/).includes('yrdly_cookie_consent=false'));
  }, [pathname]);

  if (!show) return null;

  function choose(allowed: boolean) {
    setGoogleMeasurementConsent(allowed);
    setShow(false);
    if (allowed) trackGooglePage(pathname);
  }

  return (
    <aside aria-label="Measurement cookies" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg rounded-xl border bg-background p-4 text-sm text-foreground shadow-lg">
      <p>Allow optional cookies to measure visits and conversions on YRDLY. <Link href="/privacy-policy" className="underline">Privacy policy</Link></p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="rounded-md bg-primary px-3 py-2 text-primary-foreground" onClick={() => choose(true)}>Allow measurement</button>
        <button type="button" className="rounded-md border px-3 py-2" onClick={() => choose(false)}>Decline</button>
      </div>
    </aside>
  );
}
