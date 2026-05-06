import type { Metadata } from 'next';

import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/hooks/use-supabase-auth';
import { Analytics } from '@vercel/analytics/react';
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: 'Yrdly - Your Neighborhood Network',
  description: 'Connect with your neighbors, share updates, and build a stronger community with Yrdly.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#ffffff" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Root layout: font loads for all pages. Suppress no-page-custom-font (rule targets Pages Router _document). */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Jersey+25&family=Pacifico&family=Raleway:ital,wght@0,300;0,400;0,500;1,300&display=swap"
          rel="stylesheet"
        />

      </head>

      <body className={cn('font-body antialiased min-h-screen bg-background')}>
        {/* Force dark mode synchronously before React hydration — prevents flash of light theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // Always force dark mode — clear any stale 'system' or 'light' localStorage value
                  var stored = localStorage.getItem('theme');
                  if (!stored || stored !== 'dark') {
                    localStorage.setItem('theme', 'dark');
                  }
                  document.documentElement.classList.remove('light', 'system');
                  document.documentElement.classList.add('dark');
                } catch(e) {}
              })();
            `,
          }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <AuthProvider>
            {children}
          </AuthProvider>

          <Toaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
