"use client";

import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

type Prompt = {
  id:string;prompt_date:string;question:string;category:string;status:string;
  push_title:string|null;push_body:string|null;
};
const categories=['neighbourhood','businesses','food','services','events','community'];
export default function AdminDailyPromptsPage() {
  const [items,setItems]=useState<Prompt[]>([]);
  const [startDate,setStartDate]=useState('');
  const [editing,setEditing]=useState<string|null>(null);
  const [draftText,setDraftText]=useState('');
  const [category,setCategory]=useState('neighbourhood');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(true);
  const refresh=useCallback(async()=>{
    const data=await authenticatedFetch<{prompts:Prompt[]}>('/api/daily-prompts/admin',null,'GET');
    setItems(data.prompts);
  },[]);
  useEffect(()=>{
    let active=true;
    void refresh().catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load the queue')})
      .finally(()=>{if(active)setLoading(false)});
    return ()=>{active=false};
  },[refresh]);
  const submit=async (body:Record<string,unknown>,label:string)=>{
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      await authenticatedFetch('/api/daily-prompts/admin',body);
      await refresh();
      setEditing(null);
      setMessage(label);
    }catch(e){setError(e instanceof Error?e.message:'Unable to save changes')}
    finally{setBusy(false)}
  };
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8 pb-24 space-y-5">
      <Link href="/settings" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Admin
      </Link>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold font-yrdly-display">Daily neighbourhood questions</h1>
        <p className="text-sm text-muted-foreground">Approve one question per Nigeria-local date. Drafts never appear to users.</p>
      </div>
      <section className="rounded-3xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm"><ShieldCheck className="h-4 w-4"/> Editorial queue</div>
        <p className="text-sm text-muted-foreground">Insert 30 curated drafts starting on a future date, then review and approve each one. Already-used dates are protected.</p>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm space-y-1">First draft date
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}
              className="block bg-background border rounded-xl px-3 py-2 text-foreground"/>
          </label>
          <button type="button" disabled={busy||!startDate}
            onClick={()=>void submit({action:'seed',startDate},'Thirty new drafts created. Review before approving.')}
            className="rounded-xl bg-[#82DB7E] text-black font-semibold px-4 py-2 disabled:opacity-40">
            Create 30 drafts
          </button>
        </div>
      </section>
      {error&&<p role="alert" className="rounded-xl border border-red-500/30 p-3 text-red-400 text-sm">{error}</p>}
      {message&&<p role="status" className="text-[#82DB7E] text-sm">{message}</p>}
      {loading?<p>Loading editorial queue…</p>:
       <div className="space-y-3">{items.length===0?
         <p className="text-sm text-muted-foreground">No questions scheduled yet.</p>:items.map(item=>(
         <article key={item.id} className="rounded-2xl border bg-card p-4 space-y-3">
           <div className="flex justify-between flex-wrap gap-2">
             <p className="text-xs font-semibold text-muted-foreground">{item.prompt_date} · {item.category}</p>
             <span className="text-xs font-semibold rounded-full border px-2 py-1">{item.status}</span>
           </div>
           {editing===item.id?
             <>
               <textarea value={draftText} onChange={e=>setDraftText(e.target.value)} rows={3}
                 className="w-full rounded-xl border bg-background p-3 text-sm"/>
               <select aria-label="Question category" value={category} onChange={e=>setCategory(e.target.value)}
                 className="rounded-xl border bg-background p-2 text-sm">
                 {categories.map(c=><option key={c} value={c}>{c}</option>)}
               </select>
               <div className="flex gap-2">
                 <button disabled={busy||draftText.trim().length<12} className="rounded-full bg-[#82DB7E] text-black px-4 py-2 text-sm font-bold disabled:opacity-40"
                   onClick={()=>void submit({action:'edit',id:item.id,question:draftText,category,
                     pushTitle:item.push_title,pushBody:item.push_body},'Draft updated.')}>Save draft</button>
                 <button className="rounded-full border px-4 py-2 text-sm" onClick={()=>setEditing(null)}>Cancel</button>
               </div>
             </>:
             <p className="font-semibold">{item.question}</p>}
           {!editing && <div className="flex gap-2">
             {item.status==='draft'&&<>
               <button className="rounded-full border px-4 py-2 text-sm" onClick={()=>{
                 setEditing(item.id);setDraftText(item.question);setCategory(item.category);
               }}>Edit</button>
               <button disabled={busy} className="rounded-full bg-[#82DB7E] text-black px-4 py-2 text-sm font-bold disabled:opacity-40"
                 onClick={()=>void submit({action:'approve',id:item.id},'Question approved for its scheduled date.')}>Approve</button>
             </>}
             {item.status==='approved'&&<button disabled={busy} className="rounded-full border border-amber-500/60 px-4 py-2 text-sm text-amber-400"
               onClick={()=>void submit({action:'pause',id:item.id},'Question paused and removed from public view.')}>Pause</button>}
           </div>}
         </article>
       ))}</div>}
    </main>
  );
}
