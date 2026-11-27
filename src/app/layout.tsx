import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Figtree, Unbounded } from 'next/font/google';

import './globals.css';
import { cn } from '@/lib/shared/utils';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/hooks/use-supabase-auth';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ThemeProvider } from "@/components/ThemeProvider";
import Script from "next/script";
import { AmbientBackground } from '@/components/ui/AmbientBackground';
import { ServiceWorkerRegister } from '@/components/providers/ServiceWorkerRegister';
import { PushNotificationManager } from '@/components/notifications/PushNotificationManager';
import { CrispChat } from '@/components/CrispChat';
import { TelemetryHandler } from '@/components/providers/TelemetryHandler';
import { AcquisitionCapture } from '@/components/providers/AcquisitionCapture';
import { GoogleMeasurement } from '@/components/providers/GoogleMeasurement';
import { googleTagManagerEnabled } from '@/lib/attribution/google-measurement';
import { PendingListingMeasurements } from '@/components/providers/PendingListingMeasurements';
import { SignupConversionHandler } from '@/components/providers/SignupConversionHandler';

const bricolage = Bricolage_Grotesque({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-bricolage' });
const figtree = Figtree({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-figtree' });
const unbounded = Unbounded({ subsets: ['latin'], weight: ['800'], display: 'swap', variable: '--font-unbounded' });

export const metadata: Metadata = {
  metadataBase: new URL('https://app.yrdly.ng'),
  title: 'Yrdly - Your Neighborhood Network',
  description: 'Connect with your neighbors, share updates, and build a stronger community with Yrdly.',
  robots: { index: false, follow: false },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Yrdly',
  },
  icons: {
    icon: '/icon-192x192.png',
    apple: '/icon-192x192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#82DB7E',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(bricolage.variable, figtree.variable, unbounded.variable)}>
      <head />

      <body suppressHydrationWarning className={cn('font-body antialiased min-h-[100dvh] bg-background')}>
        <AmbientBackground />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          themes={['light', 'dark']}
          enableSystem={true}
          disableTransitionOnChange
          storageKey="yrdly-theme"
        >
          <AcquisitionCapture />
          <AuthProvider>
            <SignupConversionHandler />
            {googleTagManagerEnabled && <PendingListingMeasurements />}
            <TelemetryHandler />
            {children}
            <PushNotificationManager />
            <CrispChat />
          </AuthProvider>
          <Toaster />
          <Analytics />
          <SpeedInsights />
          <ServiceWorkerRegister />
          {googleTagManagerEnabled && <GoogleMeasurement />}
          {process.env.VERCEL_ENV === "production" && !googleTagManagerEnabled && (
            <>
              <Script
                id="yrdly-google-ads-gtag"
                strategy="afterInteractive"
                src="https://www.googletagmanager.com/gtag/js?id=AW-18468457055"
              />
              <Script id="yrdly-google-ads-config" strategy="afterInteractive">{`
                window.dataLayer = window.dataLayer || [];
                if (typeof window.gtag !== 'function') {
                  window.gtag = function () { window.dataLayer.push(arguments); };
                }
                window.gtag('js', new Date());
                window.gtag('config', 'AW-18468457055');
              `}</Script>
            </>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
