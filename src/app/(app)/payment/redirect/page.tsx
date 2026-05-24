"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/* ── Design tokens ─────────────────────────────────────── */
const BG   = "var(--c-bg)";
const GREEN = "#388E3C";
const DIM  = "var(--c-text-muted)";

export default function PaymentRedirectPage() {
  const params = useSearchParams();
  const link   = params.get("link");

  /* Auto-redirect once the page mounts — only allow https:// to prevent open redirect / javascript: injection */
  useEffect(() => {
    if (link && link.startsWith('https://')) {
      const t = setTimeout(() => { window.location.href = link; }, 1500);
      return () => clearTimeout(t);
    }
  }, [link]);

  return (
    <div className="bg-surface-container-low text-on-surface font-body min-h-dvh selection:bg-primary selection:text-on-primary">
      {/* Top AppBar */}
      <header className="fixed top-0 w-full z-50 bg-[#15181D]/80 backdrop-blur-xl flex items-center px-6 h-16">
        <div className="flex items-center gap-4 w-full max-w-lg mx-auto justify-center">
          <span className="text-[#259907] font-brand text-[1.75rem]">Yrdly</span>
        </div>
      </header>

      {/* Main Canvas */}
      <main className="min-h-dvh flex flex-col items-center justify-center p-6 bg-surface-container-low">
        {/* Center Content Block */}
        <div className="flex flex-col items-center text-center space-y-8 max-w-sm mt-16">
          
          {/* Animated Spinner Container */}
          <div className="relative flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-surface-variant rounded-full"></div>
            <div className="absolute w-12 h-12 border-4 border-[#388E3C] border-t-transparent rounded-full animate-[spin_1s_linear_infinite]"></div>
          </div>
          
          {/* Loading Messaging */}
          <div className="space-y-3">
            <h1 className="font-pacifico text-[1.375rem] text-on-surface tracking-wide">
              Connecting to Flutterwave...
            </h1>
            <p className="font-editorial text-[0.8125rem] text-on-surface-variant leading-relaxed">
              Please do not close this screen
            </p>
          </div>
          
          {/* Progress Bar */}
          <div className="w-48 h-1.5 bg-surface-variant rounded-full overflow-hidden">
            <div className="h-full bg-tertiary-container rounded-full animate-[progress_3s_ease-in-out_infinite]" style={{ width: "30%" }}></div>
          </div>
        </div>

        {/* Footer Lock / Security */}
        <footer className="absolute bottom-10 flex flex-col items-center gap-2">
          <div className="flex items-center gap-1.5 text-outline">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            <span className="font-editorial text-[0.6875rem] uppercase tracking-widest">
              Secured payment
            </span>
          </div>
          {/* Subtle atmospheric glow backdrop behind the footer */}
          <div className="absolute -z-10 w-64 h-64 bg-primary/5 blur-[100px] rounded-full -bottom-20"></div>
        </footer>
      </main>

      <style>{`
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
      `}</style>
    </div>
  );
}
