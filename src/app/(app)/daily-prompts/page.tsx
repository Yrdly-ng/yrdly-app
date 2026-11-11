"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import { ArrowLeft, MessageCircle } from 'lucide-react';

type Prompt = { id: string; question: string; category: string; prompt_date: string };
type Answer = {
  id: string; user_id: string; author_name: string; author_image?: string;
  text: string; created_at: string; comment_count: number;
};
export default function DailyPromptAnswersPage() {
  const [prompt,setPrompt] = useState<Prompt | null>(null);
  const [answers,setAnswers] = useState<Answer[]>([]);
  const [nextPage,setNextPage] = useState<number | null>(null);
  const [loading,setLoading] = useState(true);
  const [loadingMore,setLoadingMore] = useState(false);
  const [error,setError] = useState('');
  useEffect(() => {
    let active = true;
    const start = async () => {
      try {
        const res = await fetch('/api/daily-prompts',{cache:'no-store'});
        if (!res.ok) throw new Error('Unable to load today’s question.');
        const data = await res.json();
        if (!active) return;
        setPrompt(data.prompt ?? null);
        if (!data.prompt) return;
        const list = await authenticatedFetch<{responses:Answer[];nextPage:number|null}>(
          `/api/daily-prompts/responses?promptId=${encodeURIComponent(data.prompt.id)}&page=0`,null,'GET');
        if (active) {setAnswers(list.responses);setNextPage(list.nextPage);}
      } catch(e) {if(active)setError(e instanceof Error ? e.message : 'Unable to load answers.');}
      finally {if(active)setLoading(false);}
    };
    void start();
    return () => {active=false;};
  },[]);
  const loadMore = async () => {
    if (!prompt || nextPage === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const list = await authenticatedFetch<{responses:Answer[];nextPage:number|null}>(
        `/api/daily-prompts/responses?promptId=${encodeURIComponent(prompt.id)}&page=${nextPage}`,null,'GET');
      setAnswers(prev => [...prev,...list.responses.filter(item=>!prev.some(p=>p.id===item.id))]);
      setNextPage(list.nextPage);
    } catch {setError('More responses could not be loaded.');}
    finally{setLoadingMore(false);}
  };
  return (
    <main className="max-w-2xl mx-auto px-4 py-8 pb-28 space-y-5">
      <Link href="/home" className="flex items-center gap-2 text-sm text-[var(--yrdly-label)]"><ArrowLeft className="h-4 w-4"/> Home</Link>
      {loading ? <p className="text-sm text-muted-foreground">Loading today's question…</p> :
        !prompt ? <div className="rounded-3xl border p-6 text-center"><h1 className="font-bold text-lg">No question is live right now</h1><p className="text-sm text-muted-foreground mt-2">Check back for the next neighbourhood conversation.</p></div> :
        <>
          <header className="rounded-3xl border border-[#82DB7E]/30 bg-[#82DB7E]/10 p-5 space-y-3">
            <p className="uppercase text-xs font-bold tracking-wider text-[#82DB7E]">Today's neighbourhood question</p>
            <h1 className="font-yrdly-display text-xl font-bold">{prompt.question}</h1>
            <Link className="inline-flex items-center gap-2 rounded-full bg-[#82DB7E] text-black px-4 py-2 font-bold text-sm"
              href={`/posts/create?dailyPrompt=${encodeURIComponent(prompt.id)}`}><MessageCircle className="h-4 w-4"/> Share your answer</Link>
          </header>
          <h2 className="font-bold text-lg">Answers from your neighbourhood</h2>
          {answers.length===0 ? <p className="text-sm text-muted-foreground">No responses nearby yet. You can be the first!</p> :
            <div className="space-y-3">{answers.map(answer=>(
              <article key={answer.id} className="rounded-2xl border bg-card p-4 space-y-2">
                <p className="font-semibold text-sm">{answer.author_name}</p>
                <p className="text-sm whitespace-pre-wrap break-words">{answer.text}</p>
                <Link href={`/posts/${answer.id}`} className="text-[#82DB7E] text-xs font-medium">Join the conversation · {answer.comment_count || 0} comments</Link>
              </article>
            ))}</div>}
          {nextPage!==null&&<button onClick={()=>void loadMore()} disabled={loadingMore}
            className="rounded-full border px-4 py-2 text-sm font-medium">{loadingMore?'Loading…':'Load more answers'}</button>}
        </>}
      {error&&<p role="alert" className="text-sm text-amber-500">{error}</p>}
    </main>
  );
}
