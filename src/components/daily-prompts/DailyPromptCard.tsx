"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, ArrowRight, Sparkles } from 'lucide-react';

type Today = { date: string; prompt: null | { id: string; question: string; category: string; prompt_date: string } };

/** Safe to render with no migration or when the feature is disabled. */
export default function DailyPromptCard() {
  const [today,setToday] = useState<Today | null>(null);
  useEffect(() => {
    let active = true;
    const reload = async () => {
      try {
        const response = await fetch('/api/daily-prompts',{cache:'no-store'});
        if (!response.ok) return;
        const data = await response.json() as Today;
        if (active) setToday(data);
      } catch { /* No prompt is better than an unreviewed fallback. */ }
    };
    void reload();
    const onFocus = () => { if(document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange',onFocus);
    return () => { active=false;document.removeEventListener('visibilitychange',onFocus); };
  },[]);
  if (!today?.prompt) return null;
  return (
    <section aria-label="Today's neighbourhood question"
      className="rounded-3xl border border-[#82DB7E]/30 bg-gradient-to-br from-[#82DB7E]/10 via-card to-card p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#82DB7E]">
        <Sparkles className="h-4 w-4" aria-hidden />
        TODAY'S NEIGHBOURHOOD QUESTION
      </div>
      <h2 className="text-lg sm:text-xl font-bold leading-snug text-foreground font-yrdly-display">
        {today.prompt.question}
      </h2>
      <p className="text-xs sm:text-sm text-[var(--yrdly-label)]">
        Share your experience with neighbours nearby. Real recommendations, real conversations.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/posts/create?dailyPrompt=${encodeURIComponent(today.prompt.id)}`}
          className="inline-flex items-center gap-2 rounded-full bg-[#82DB7E] text-black px-4 py-2 text-sm font-bold font-yrdly-display">
          <MessageCircle className="h-4 w-4" aria-hidden/> Answer prompt
        </Link>
        <Link href="/daily-prompts"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--yrdly-glass-border)] px-4 py-2 text-sm font-medium text-foreground">
          See neighbours' answers <ArrowRight className="h-4 w-4" aria-hidden/>
        </Link>
      </div>
    </section>
  );
}
