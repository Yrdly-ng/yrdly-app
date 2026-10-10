import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/hooks/use-supabase-auth';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ThemeProvider } from "@/components/ThemeProvider";
import Script from "next/script";
import { AmbientBackground } from '@/components/ui/AmbientBackground';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { PushNotificationManager } from '@/components/PushNotificationManager';
import { CrispChat } from '@/components/CrispChat';

const raleway = localFont({
  src: './fonts/raleway.woff2',
  variable: '--font-raleway',
  weight: '100 900',
  display: 'swap',
});

const jersey25 = localFont({
  src: './fonts/jersey25.woff2',
  variable: '--font-jersey25',
  weight: '400',
  display: 'swap',
});

const pacifico = localFont({
  src: './fonts/pacifico.woff2',
  variable: '--font-pacifico',
  weight: '400',
  display: 'swap',
});

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
    <html lang="en" className={cn(raleway.variable, jersey25.variable, pacifico.variable)} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{__html: `
          body { font-feature-settings: "cv11", "ss01"; }
        `}} />
      </head>

      <body className={cn('font-body antialiased min-h-[100dvh] bg-background')}>
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
