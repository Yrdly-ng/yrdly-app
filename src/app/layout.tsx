import type { Metadata, Viewport } from 'next';

import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/hooks/use-supabase-auth';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ThemeProvider } from "@/components/ThemeProvider";
import Script from "next/script";

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: 'var(--c-bg)' }
  ]
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
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Jersey+25&family=Pacifico&display=swap"
          rel="stylesheet"
        />
      </head>

      <body className={cn('font-body antialiased min-h-[100dvh] bg-background')}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          themes={['light', 'dark']}
          enableSystem={false}
          disableTransitionOnChange
          storageKey="yrdly-theme"
        >
          <AuthProvider>
            {children}
          </AuthProvider>
          <Toaster />
          <Analytics />
          <SpeedInsights />

          <Script id="zohodeskasap" strategy="lazyOnload">
            {`
              window.ZohoDeskAsapReady=function(s){var e=window.ZohoDeskAsap__asyncalls=window.ZohoDeskAsap__asyncalls||[];window.ZohoDeskAsapReadyStatus?(s&&e.push(s),e.forEach(s=>s&&s()),window.ZohoDeskAsap__asyncalls=null):s&&e.push(s)};
              window.ZohoDeskAsapReady(function() {
                if (window.ZohoDeskAsap) {
                  window.ZohoDeskAsap.invoke('hide', 'launcher');
                }
              });
            `}
          </Script>
          <Script 
            id="zohodeskasapscript" 
            strategy="lazyOnload" 
            src="https://desk.zoho.com/portal/api/web/asapApp/1369927000000404854?orgId=925875390" 
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
