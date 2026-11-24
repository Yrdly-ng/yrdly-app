'use client';

import { APIProvider, APILoadingStatus, useApiLoadingStatus } from '@vis.gl/react-google-maps';
import { useEffect, useRef, type ReactNode } from 'react';
import { captureWebError } from '@/lib/telemetry/sentry';

const libraries = ['places'];

function MapsDiagnostics() {
  const status = useApiLoadingStatus();
  const reportedAuthFailure = useRef(false);
  useEffect(() => {
    if (status === APILoadingStatus.AUTH_FAILURE && !reportedAuthFailure.current) {
      reportedAuthFailure.current = true;
      captureWebError(new Error('Google Maps authorization failed'), { operation: 'maps.auth' });
    }
  }, [status]);
  return null;
}

export function GoogleMapsProvider({ children }: { children: ReactNode }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return <>{children}</>;

  return (
    <APIProvider
      apiKey={apiKey}
      libraries={libraries}
      onError={(error) => {
        const reason = !navigator.onLine
          ? new Error('Google Maps unavailable while offline')
          : error instanceof Error
            ? error
            : new Error('Google Maps script failed to load');
        captureWebError(reason, { operation: 'maps.load' });
      }}
    >
      <MapsDiagnostics />
      {children}
    </APIProvider>
  );
}
