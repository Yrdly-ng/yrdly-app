'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/supabase';

type Progress = { enabled: boolean; financialHold?: boolean; settled?: boolean; canPay: boolean; milestones: { position: number; amount_kobo: number; status: string; canApprove: boolean }[] };
export function BookingMilestones({ bookingId, onChanged, onPay }: { bookingId: string; onChanged: () => void; onPay: () => void }) {
  const [progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const call=useCallback(async(path:string,body?:unknown)=>{
    const {data:{session}}=await supabase.auth.getSession();
    const r=await fetch(`/api/bookings/${bookingId}/milestones${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session?.access_token||''}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const result=await r.json();if(!r.ok)throw new Error(result.error||'Could not load payment.');return result;
  },[bookingId]);
  const refresh=useCallback(async()=>{try{setError('');setProgress(await call(''));}catch(e){setError(e instanceof Error?e.message:'Could not load payment.');}},[call]);
  useEffect(()=>{void refresh();},[refresh]);
  const approve=async(position:number)=>{
    if(busy||!window.confirm(position===1?'Release the first half to the business so work can begin? Released funds cannot be disputed through the held-funds process.':'Confirm the service is complete and release the remaining half?'))return;
    setBusy(true);try{const result=await call('/approve',{position,confirm:true});await refresh();onChanged();if(result.status!=='released')setError(result.message);}catch(e){setError(e instanceof Error?e.message:'Release needs checking.');}finally{setBusy(false);}
  };
  return <section className="rounded-2xl border border-border bg-card p-5 space-y-3"><h3 className="font-semibold">Pay securely in two stages</h3>
    <p className="text-sm text-muted-foreground">Fund the full service price plus the payment fee. You approve half before work starts and the rest after completion. Any odd kobo stays in the final half.</p>
    {error&&<p role="alert">{error}</p>}
    {!progress&&!error&&<p role="status">Loading payment progress…</p>}
    {progress&&!progress.enabled&&<p>Online staged payments are not available yet. No payment is expected now.</p>}
    {progress?.financialHold&&<p role="status">Payment is on hold while the dispute is reviewed.</p>}
    {progress?.settled&&<p>Dispute settlement is complete. No further milestone approval is needed.</p>}
    {progress?.enabled && progress.canPay && <button disabled={busy} onClick={onPay} className="rounded-xl border px-4 py-2">Review full booking payment</button>}
    {progress?.milestones.map(m=><div key={m.position} className="flex flex-wrap items-center justify-between gap-3"><span>{m.position===1?'First half':'Final half'} · ₦{(m.amount_kobo/100).toLocaleString('en-NG',{minimumFractionDigits:2})} · {m.status==='settled'?'Settled':m.status==='released'?'Released':m.status==='approving'?'Checking release':'Held'}</span>{m.canApprove&&<button disabled={busy} onClick={()=>void approve(m.position)} className="rounded-xl border px-4 py-2">{busy?'Checking…':m.status==='approving'?'Check release':m.position===1?'Approve first half':'Approve final half'}</button>}</div>)}
    <button disabled={busy} onClick={()=>void refresh()} className="text-sm underline">Refresh payment progress</button>
  </section>;
}
