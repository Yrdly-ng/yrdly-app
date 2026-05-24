"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ReviewService } from "@/lib/review-service";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";

/* ── Design tokens ─────────────────────────────────── */
const BG     = "var(--c-bg)";
const CARD   = "var(--c-bg)";
const CARDH  = "var(--c-card2)";
const Green  = "#388E3C";
const GreenL = "#82DB7E";
const MUTED  = "var(--c-text-muted)";
const DIM    = "var(--c-text-muted)";

const QUICK_TAGS = [
  "Fast response",
  "Item as described",
  "Great seller",
  "Would recommend",
  "Honest & reliable",
  "Easy transaction",
];

const STAR_LABELS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

export default function ReviewPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const params    = useSearchParams();
  const router    = useRouter();
  const { toast } = useToast();
  const { user }  = useAuth();

  const sellerName = params.get("seller") ?? "Seller";

  const [rating, setRating]     = useState(4);
  const [hover, setHover]       = useState(0);
  const [text, setText]         = useState("");
  const [tags, setTags]         = useState<string[]>(["Fast response"]);
  const [loading, setLoading]   = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);

  // Resolve businessId from the transaction's item
  useEffect(() => {
    async function fetchBusinessId() {
      const { data } = await supabase
        .from('escrow_transactions')
        .select('item:posts(business_id)')
        .eq('id', transactionId)
        .single();
      if (data?.item?.[0]?.business_id) {
        setBusinessId(data.item[0].business_id);
      }
    }
    fetchBusinessId();
  }, [transactionId]);

  const toggleTag = (t: string) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const handleSubmit = useCallback(async () => {
    if (!rating || !user) return;
    setLoading(true);
    try {
      const comment = [text, ...tags].filter(Boolean).join(' | ');
      if (businessId) {
        await ReviewService.submitReview(businessId, user.id, transactionId, rating, comment);
      }
      toast({ title: "Review submitted!", description: "Thank you for your feedback." });
      router.push(`/transactions/${transactionId}`);
    } catch {
      toast({ title: "Error", description: "Could not submit review.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [rating, transactionId, toast, router, user, businessId, text, tags]);

  const display = hover || rating;

  return (
    <div className="bg-background text-on-background font-body selection:bg-primary/30 min-h-dvh">
      {/* Visual Background Element */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-5%] left-[-10%] w-[40%] h-[40%] bg-secondary/5 rounded-full blur-[100px]"></div>
      </div>

      {/* Top App Bar */}
      <header className="fixed top-0 w-full z-50 bg-[#15181D]/80 backdrop-blur-xl flex items-center px-6 h-16 w-full">
        <div className="flex items-center gap-4 w-full">
          <button onClick={() => router.back()} className="active:scale-95 transition-transform hover:opacity-80 transition-opacity">
            <ArrowLeft className="text-[#388E3C] w-6 h-6" />
          </button>
          <h1 className="font-pacifico text-2xl tracking-tight text-on-surface" style={{ fontFamily: "Pacifico, cursive" }}>Leave a Review</h1>
        </div>
      </header>

      <main className="pt-24 pb-12 px-6 max-w-2xl mx-auto flex flex-col gap-10">
        {/* User Card */}
        <section className="flex items-center gap-5 p-4 bg-surface-container-low rounded-lg">
          <div className="relative flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold border-2 border-primary/20" style={{ background: "var(--c-card2)", color: "#82DB7E" }}>
            {sellerName.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="font-editorial font-bold text-lg leading-tight" style={{ fontFamily: "Raleway, sans-serif" }}>{sellerName}</h2>
            <div className="flex">
              <span className="text-[0.625rem] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container">Seller</span>
            </div>
          </div>
        </section>

        {/* Star Rating Section */}
        <section className="flex flex-col items-center gap-4 py-4">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <svg 
                key={s}
                onClick={() => setRating(s)}
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(0)}
                viewBox="0 0 24 24" 
                className={`w-12 h-12 cursor-pointer transition-transform hover:scale-110 ${s <= display ? 'text-[#FFD700] fill-[#FFD700]' : 'text-outline fill-transparent'}`} 
                stroke="currentColor" 
                strokeWidth="1.5"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            ))}
          </div>
          <p className="font-editorial text-primary-fixed-dim text-lg font-semibold" style={{ fontFamily: "Raleway, sans-serif" }}>
            {STAR_LABELS[display]}
          </p>
        </section>

        {/* Review Text Area */}
        <section className="flex flex-col gap-3">
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 120))}
              className="w-full bg-surface-container-high border-0 focus:ring-2 focus:ring-[#388E3C] rounded-[11px] p-4 font-editorial italic font-light text-on-surface-variant placeholder:text-on-surface-variant/40 resize-none transition-all"
              style={{ fontFamily: "Raleway, sans-serif" }}
              placeholder="Share your experience... (optional)"
              rows={5}
            ></textarea>
            <div className="absolute bottom-3 right-4 text-[0.6875rem] font-label text-outline">
              {text.length} / 120
            </div>
          </div>
        </section>

        {/* Tags Row */}
        <section className="flex flex-col gap-4">
          <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-outline">Quick Feedback</h3>
          <div className="flex flex-wrap gap-3">
            {QUICK_TAGS.map((t) => {
              const active = tags.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-editorial font-semibold transition-all ${
                    active 
                      ? "bg-[#06171B] border border-[#388E3C] text-[#BBF7D0]" 
                      : "bg-surface-container border border-white/10 text-on-surface-variant hover:border-white/20"
                  }`}
                  style={{ fontFamily: "Raleway, sans-serif" }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </section>

        {/* Actions */}
        <section className="flex flex-col items-center gap-6 mt-4">
          <button 
            onClick={handleSubmit}
            disabled={!rating || loading}
            className="w-full py-4 bg-[#388E3C] text-on-primary font-editorial font-bold text-lg rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100"
            style={{ fontFamily: "Raleway, sans-serif" }}
          >
            {loading ? "Submitting..." : "Submit Review"}
          </button>
          <button 
            onClick={() => router.back()}
            className="text-outline font-editorial text-sm font-semibold hover:text-on-surface transition-colors"
            style={{ fontFamily: "Raleway, sans-serif" }}
          >
            Skip for now
          </button>
        </section>
      </main>
    </div>
  );
}
