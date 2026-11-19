'use client';

import Script from 'next/script';
import { captureWebError } from '@/lib/telemetry/sentry';

export function GoogleMapsScript() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  return (
    <Script
      src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`}
      strategy="afterInteractive"
      onError={() => captureWebError(new Error('Google Maps script failed to load'), { operation: 'maps.load' })}
    />
  );
}
