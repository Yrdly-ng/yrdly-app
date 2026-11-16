"use client";

import { CrashFallback } from '@/components/CrashFallback';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body>
        <CrashFallback error={error} reset={reset} />
      </body>
    </html>
  );
}
