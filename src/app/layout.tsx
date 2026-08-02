import type { Metadata, Viewport } from 'next';

// @ts-ignore
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/hooks/use-supabase-auth';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ThemeProvider } from "@/components/ThemeProvider";
import Script from "next/script";
import { Suspense } from 'react';
import PostHogPageView from '@/components/providers/PostHogPageView';
import { PostHogProvider } from '@/components/providers/PostHogProvider';
import { AmbientBackground } from '@/components/ui/AmbientBackground';
import { ZohoDeskScript } from '@/components/ZohoDeskScript';

export const metadata: Metadata = {
  title: 'Yrdly - Your Neighborhood Network',
  description: 'Connect with your neighbors, share updates, and build a stronger community with Yrdly.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
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
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Jersey+25&family=Raleway:wght@300;400;500;600;700&family=Work+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>

      <body className={cn('font-body antialiased min-h-[100dvh] bg-background')}>
        <AmbientBackground />
        <PostHogProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            themes={['light', 'dark']}
            enableSystem={true}
            disableTransitionOnChange
            storageKey="yrdly-theme"
          >
            <AuthProvider>
              <Suspense fallback={null}>
                <PostHogPageView />
              </Suspense>
              {children}
            </AuthProvider>
          <Toaster />
          <Analytics />
          <SpeedInsights />
          <ZohoDeskScript />
        </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}