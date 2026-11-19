"use client";

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import { ArrowLeft, MessageCircle } from 'lucide-react';

type Prompt = { id: string; question: string; category: string; prompt_date: string };
type Answer = {
  id: string; user_id: string; author_name: string; author_image?: string;
  text: string; created_at: string; comment_count: number;
};
function AnswerCard({ answer }: { answer: Answer }) {
  return <article className="rounded-2xl border bg-card p-4 space-y-2">
    <p className="font-semibold text-sm">{answer.author_name}</p>
    <p className="text-base leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{answer.text}</p>
    <Link href={`/posts/${answer.id}`} className="inline-flex min-h-11 items-center text-primary text-sm font-medium">Join the conversation · {answer.comment_count || 0} comments</Link>
  </article>;
}
export default function DailyPromptAnswersPage() {
  return <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading question…</p>}><DailyPromptAnswersContent /></Suspense>;
}
function DailyPromptAnswersContent() {
  const params = useSearchParams();
  const requestedId = params.get('promptId');
  const answerId = params.get('answerId');
  const [currentDate,setCurrentDate] = useState('');
  const [prompt,setPrompt] = useState<Prompt | null>(null);
  const [answers,setAnswers] = useState<Answer[]>([]);
  const [linkedAnswer,setLinkedAnswer] = useState<Answer | null>(null);
  const [nextPage,setNextPage] = useState<number | null>(null);
  const [loading,setLoading] = useState(true);
  const [loadingMore,setLoadingMore] = useState(false);
  const [error,setError] = useState('');
  const [reload,setReload] = useState(0);
  const [locationRequired,setLocationRequired] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setLocationRequired(false);
    setPrompt(null);
    setAnswers([]);
    setLinkedAnswer(null);
    setNextPage(null);
    const start = async () => {
      try {
        const endpoint = requestedId ? `/api/daily-prompts?promptId=${encodeURIComponent(requestedId)}` : '/api/daily-prompts';
        const res = await fetch(endpoint,{cache:'no-store'});
        if (!res.ok) throw new Error('This question is unavailable.');
        const data = await res.json();
        if (!active) return;
        setCurrentDate(data.date);
        setPrompt(data.prompt ?? null);
        if (!data.prompt) return;
        const query = new URLSearchParams({ promptId: data.prompt.id, page: '0' });
        if (answerId) query.set('answerId', answerId);
        const list = await authenticatedFetch<{responses:Answer[];linkedAnswer?:Answer|null;nextPage:number|null;locationRequired?:boolean}>(
          `/api/daily-prompts/responses?${query}`,null,'GET');
        if (!Array.isArray(list.responses)) throw new Error('Answers are temporarily unavailable. Please try again.');
        if (active) {
          setAnswers(list.responses);
          setLinkedAnswer(list.linkedAnswer?.id === answerId ? list.linkedAnswer : null);
          setNextPage(list.nextPage);
          setLocationRequired(list.locationRequired === true);
        }
      } catch(e) {if(active)setError(e instanceof Error ? e.message : 'Unable to load answers.');}
      finally {if(active)setLoading(false);}
    };
    void start();
    return () => {active=false;};
  },[requestedId,answerId,reload]);
  const loadMore = async () => {
    if (!prompt || nextPage === null || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const list = await authenticatedFetch<{responses:Answer[];nextPage:number|null;locationRequired?:boolean}>(
        `/api/daily-prompts/responses?promptId=${encodeURIComponent(prompt.id)}&page=${nextPage}`,null,'GET');
      if (!Array.isArray(list.responses)) throw new Error('Invalid answers response');
      setAnswers(prev => [...prev,...list.responses.filter(item=>!prev.some(p=>p.id===item.id))]);
      setNextPage(list.nextPage);
    } catch {setError('More responses could not be loaded.');}
    finally{setLoadingMore(false);}
  };
  const localAnswers = answers.filter(answer => answer.id !== linkedAnswer?.id);
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-28 space-y-5">
      <Link href="/home" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"><ArrowLeft className="h-4 w-4"/> Home</Link>
      {loading ? <p className="text-sm text-muted-foreground">Loading today&apos;s question…</p> :
        !prompt ? <div className="rounded-3xl border p-6 text-center"><h1 className="font-bold text-lg">No question is live right now</h1><p className="text-sm text-muted-foreground mt-2">Check back for the next neighbourhood conversation.</p></div> :
        <>
          <header className="rounded-3xl border border-primary/30 bg-primary/10 p-5 space-y-3">
            <p className="uppercase text-xs font-bold tracking-wider text-primary">{prompt.prompt_date === currentDate ? "Today’s neighbourhood question" : "Past neighbourhood question"}</p>
            <h1 className="font-yrdly-display text-xl font-bold">{prompt.question}</h1>
            {prompt.prompt_date === currentDate ? <Link className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 font-bold text-sm"
              href={`/posts/create?dailyPrompt=${encodeURIComponent(prompt.id)}`}><MessageCircle className="h-4 w-4"/> Share your answer</Link> :
              <Link href="/daily-prompts" className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-primary underline underline-offset-4">View today’s question</Link>}
          </header>
          {linkedAnswer && <section className="space-y-3" aria-label="Answer you opened">
            <h2 className="font-bold text-lg">Answer you opened</h2>
            <AnswerCard answer={linkedAnswer} />
          </section>}
          <h2 className="font-bold text-lg">{linkedAnswer ? 'Other answers from your neighbourhood' : 'Answers from your neighbourhood'}</h2>
          {locationRequired ? <div className="rounded-2xl border bg-card p-5 space-y-3"><h3 className="font-semibold">Choose your neighbourhood to see local answers</h3><p className="text-sm text-muted-foreground">Set your home state and area so we can show answers from your neighbours.</p><Link href="/onboarding/profile" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline">Set your home neighbourhood</Link></div> : error && localAnswers.length===0 ? null : localAnswers.length===0 ?
            <p className="text-sm text-muted-foreground">{linkedAnswer ? 'No other answers from your home neighbourhood.' : 'No answers from your home neighbourhood.'}</p> :
            <div className="space-y-3">{localAnswers.map(answer => <AnswerCard key={answer.id} answer={answer} />)}</div>}
          {nextPage!==null&&<button onClick={()=>void loadMore()} disabled={loadingMore}
            className="min-h-11 rounded-full border px-4 py-2 text-sm font-medium">{loadingMore?'Loading…':'Load more answers'}</button>}
        </>}
      {error&&<div role="alert" className="rounded-2xl border bg-card p-4 space-y-2"><p className="text-sm text-foreground">{error}</p><button type="button" onClick={()=>nextPage !== null && answers.length > 0 ? void loadMore() : setReload(value=>value+1)} disabled={loading || loadingMore} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-primary underline">Try again</button></div>}
    </div>
  );
}
