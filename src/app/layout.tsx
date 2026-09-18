import type { Metadata, Viewport } from 'next';
import { Raleway, Jersey_25, Pacifico } from 'next/font/google';

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

const raleway = Raleway({
  subsets: ['latin'],
  variable: '--font-raleway',
  weight: ['400', '500', '600', '700', '800'],
});

const jersey25 = Jersey_25({
  subsets: ['latin'],
  variable: '--font-jersey25',
  weight: ['400'],
});

const pacifico = Pacifico({
  subsets: ['latin'],
  variable: '--font-pacifico',
  weight: ['400'],
});

export const metadata: Metadata = {
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
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