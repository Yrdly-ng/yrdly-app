"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, Quote } from "lucide-react";

type Question = { id: string; question: string };
// Share only concurrent public-question reads. Nothing persists across sign-in
// changes or keeps a paused question cached after the request completes.
const pending = new Map<string, Promise<Question | null>>();
function loadQuestion(id: string) {
  const existing = pending.get(id);
  if (existing) return existing;
  const request = fetch(`/api/daily-prompts?promptId=${encodeURIComponent(id)}`, { cache: "no-store" })
    .then(async response => {
      if (!response.ok) return null;
      const data = await response.json();
      return data.prompt?.id === id ? data.prompt : null;
    })
    .catch(() => null)
    .finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}

export function DailyPromptQuote({ promptId }: { promptId?: string | null }) {
  const [result, setResult] = useState<{ id: string; question: Question | null } | null>(null);
  const question = result && result.id === promptId ? result.question : null;
  const loading = !!promptId && result?.id !== promptId;
  useEffect(() => {
    if (!promptId) return;
    let active = true;
    void loadQuestion(promptId).then(value => {
      if (active) setResult({ id: promptId, question: value });
    });
    return () => { active = false; };
  }, [promptId]);
  if (!promptId) return null;
  return (
    <aside aria-label="Daily question context" className="mx-4 mb-3 rounded-2xl border border-primary/25 bg-primary/10 p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Quote aria-hidden="true" className="h-4 w-4 shrink-0" /> Answering a neighbourhood question</p>
      {loading ? <p className="text-sm text-muted-foreground" role="status">Loading question…</p> :
        question ? <blockquote className="font-yrdly-display text-base font-semibold leading-relaxed [overflow-wrap:anywhere]">{question.question}</blockquote> :
        <p className="text-sm text-muted-foreground">The original question is currently unavailable.</p>}
      {question && <Link href={`/daily-prompts?promptId=${encodeURIComponent(promptId)}`} onClick={event => event.stopPropagation()}
        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-foreground underline decoration-primary underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <MessageCircle aria-hidden="true" className="h-4 w-4 shrink-0" /> View question and neighbours’ answers
      </Link>}
    </aside>
  );
}
