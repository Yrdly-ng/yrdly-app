"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, ArrowLeft, Clock } from "lucide-react";
import { useState } from "react";

/* ── Design tokens ─────────────────────────────────── */
const BG    = "var(--c-bg)";
const CARD  = "var(--c-card)";
const CARDH = "var(--c-card2)";
const GREEN  = "#388E3C";
const GREEN_L = "#82DB7E";
const MUTED  = "var(--c-text-muted)";
const DIM    = "var(--c-text-muted)";

const STARS = [1, 2, 3, 4, 5];

export default function PayoutSuccessPage() {
  const params        = useSearchParams();
  const router        = useRouter();
  const transactionId = params.get("txn") ?? "";
  const amount        = params.get("amount") ?? "0";
  const account       = params.get("account") ?? "••• 0000";

  const [rating, setRating]   = useState(4);
  const [review, setReview]   = useState("");
  const [submitted, setSubmit] = useState(false);

  const fmt = (n: string) =>
    `₦${Number(n).toLocaleString("en-NG")}`;

  return (
    <div className="bg-background text-on-background font-body antialiased min-h-dvh flex flex-col items-center">
      {/* Top App Bar */}
      <header className="fixed top-0 w-full z-50 bg-[var(--c-bg)]/80 backdrop-blur-xl flex items-center px-6 h-16 w-full">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/marketplace")} className="active:scale-95 transition-transform hover:opacity-80">
            <ArrowLeft className="w-6 h-6 text-[#388E3C]" />
          </button>
          <h1 className="font-pacifico text-2xl tracking-tight text-on-surface">Checkout</h1>
        </div>
      </header>

      {/* Main Content Canvas */}
      <main className="w-full max-w-md px-6 pt-24 pb-12 flex flex-col items-center relative">
        {/* Subtle Confetti Background Effect */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(circle, #82db7e 1px, transparent 1px)", backgroundSize: "24px 24px", opacity: 0.1 }}></div>
        
        {/* Success Animation/Icon Area */}
        <div className="relative mb-8 flex justify-center items-center">
          <div className="absolute w-32 h-32 bg-primary/20 rounded-full blur-3xl"></div>
          <div className="w-24 h-24 bg-surface-container-high rounded-full flex items-center justify-center border-2 border-primary shadow-[0_0_30px_rgba(130,219,126,0.3)] z-10">
            <CheckCircle className="text-primary w-14 h-14" />
          </div>
        </div>

        {/* Success Message */}
        <div className="text-center space-y-2 mb-10 z-10">
          <h2 className="font-pacifico text-[1.75rem] text-white leading-tight">
            {amount !== "0" ? `${fmt(amount)} Sent!` : "Payout Sent!"}
          </h2>
          <p className="font-raleway text-[0.8125rem] text-on-surface-variant max-w-[280px] mx-auto">
            Transferred to your account {account}
          </p>
          <div className="inline-flex items-center px-3 py-1 bg-tertiary/10 border border-tertiary/20 rounded-full mt-4">
            <Clock className="text-tertiary w-3.5 h-3.5 mr-1.5" />
            <span className="font-raleway font-semibold text-[0.6875rem] text-tertiary uppercase tracking-wider">
              Arrives within 24 hours
            </span>
          </div>
        </div>

        {/* Transaction Summary Card */}
        <div className="w-full bg-surface-container rounded-xl p-5 mb-10 border border-outline-variant/10 shadow-lg z-10">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="font-raleway text-[0.6875rem] text-on-surface-variant uppercase tracking-tight">Ref Number</span>
              <span className="font-body text-[0.75rem] text-on-surface">#{transactionId ? transactionId.slice(0, 10).toUpperCase() : "TXN-XXXXX"}</span>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="font-raleway text-[0.6875rem] text-on-surface-variant uppercase tracking-tight">Date</span>
              <span className="font-body text-[0.75rem] text-on-surface">
                {new Date().toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            </div>
          </div>
        </div>

        {/* Review Prompt Section */}
        {!submitted ? (
          <section className="w-full flex flex-col items-center z-10">
            <h3 className="font-raleway font-bold text-sm text-white mb-6">How was your experience?</h3>
            
            {/* Rating Row */}
            <div className="flex gap-3 mb-8">
              {STARS.map((s) => (
                <button
                  key={s}
                  onClick={() => setRating(s)}
                  className="transition-transform hover:scale-110 active:scale-95"
                >
                  <svg viewBox="0 0 24 24" className="w-8 h-8" fill={s <= rating ? "#a5c8ff" : "none"} stroke={s <= rating ? "#a5c8ff" : "var(--color-outline-variant, #40493d)"} strokeWidth="1.5">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </button>
              ))}
            </div>

            {/* Review Textarea */}
            <div className="w-full mb-8">
              <label className="sr-only" htmlFor="review">Leave a review</label>
              <textarea
                id="review"
                value={review}
                onChange={(e) => setReview(e.target.value)}
                placeholder="Tell others about your experience (optional)..."
                rows={3}
                className="w-full bg-surface-container-high border-[0.5px] border-primary/20 rounded-xl p-4 text-on-surface text-sm font-raleway focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/40 resize-none outline-none"
              />
            </div>

            {/* Actions */}
            <div className="w-full flex flex-col items-center gap-4">
              <button
                onClick={() => setSubmit(true)}
                className="w-full py-4 bg-gradient-to-r from-primary to-primary-container rounded-full font-raleway font-bold text-on-primary-container active:scale-95 transition-transform shadow-lg shadow-primary/10"
              >
                Submit Review
              </button>
              <button
                onClick={() => router.push("/profile")}
                className="font-raleway text-sm text-on-surface-variant hover:text-white transition-colors py-2 px-6"
              >
                Skip
              </button>
            </div>
          </section>
        ) : (
          <div className="w-full text-center space-y-4 z-10 mt-4">
            <CheckCircle className="w-10 h-10 mx-auto text-primary" />
            <p className="font-raleway font-bold text-white">
              Thanks for your review!
            </p>
            <button
              onClick={() => router.push("/marketplace")}
              className="w-full py-4 rounded-full font-raleway font-bold bg-primary text-on-primary-container mt-6 active:scale-95 transition-transform"
            >
              Back to Marketplace
            </button>
          </div>
        )}
      </main>

      {/* Footer Spacer */}
      <footer className="h-8 w-full"></footer>
    </div>
  );
}
