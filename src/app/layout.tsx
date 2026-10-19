import type { Metadata, Viewport } from 'next';

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

export const metadata: Metadata = {
  metadataBase: new URL('https://app.yrdly.ng'),
  title: 'Yrdly - Your Neighborhood Network',
  description: 'Connect with your neighbors, share updates, and build a stronger community with Yrdly.',
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700&family=Figtree:wght@400;500;600;700&family=Unbounded:wght@800&display=swap"
          rel="stylesheet"
        />
        <style dangerouslySetInnerHTML={{__html: `
          :root {
            --font-raleway: 'Bricolage Grotesque', 'Figtree', sans-serif;
            --font-jersey25: 'Bricolage Grotesque', 'Figtree', sans-serif;
            --font-pacifico: 'Bricolage Grotesque', 'Figtree', sans-serif;
          }
          button.font-yrdly-display, a.font-yrdly-display { font-family: var(--yrdly-font-body, 'Figtree'), sans-serif; }
          .font-wordmark { font-family: 'Unbounded', 'Bricolage Grotesque', sans-serif; font-weight: 800; }
        `}} />
      </head>

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
          <AuthProvider>
            <TelemetryHandler />
            {children}
            <PushNotificationManager />
            <CrispChat />
          </AuthProvider>
          <Toaster />
          <Analytics />
          <SpeedInsights />
          <ServiceWorkerRegister />
          {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && (
            <Script
              src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`}
              strategy="afterInteractive"
            />
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
