"use client";
import { useEffect, useState } from 'react';
import { AppealService } from '@/lib/appeal-service';
export default function AppealsAdminPage(){
  const [appeals,setAppeals]=useState<any[]>([]); const [busy,setBusy]=useState<string|null>(null);
  useEffect(()=>{ AppealService.listAllAppeals().then(setAppeals).catch(()=>{}); },[]);
  const review=async(id:string, d:'approved'|'rejected')=>{
    setBusy(id);
    try{ const r=await AppealService.reviewAppeal(id,d); setAppeals(a=>a.map(x=>x.id===id?r:x)); } finally { setBusy(null); }
  };
  return <div className="p-6 max-w-4xl mx-auto space-y-4"><h1 className="text-xl font-semibold">Strike Appeals</h1>
  {appeals.length===0 && <p className="text-sm text-muted-foreground">No appeals.</p>}
  {appeals.map(a=>(
    <div key={a.id} className="border rounded-lg p-4 space-y-2">
      <div className="text-sm"><b>{a.appellant_type}</b> appeal — status <b>{a.status}</b></div>
      <div className="text-sm text-muted-foreground">{a.reason}</div>
      <div className="text-xs text-muted-foreground">Booking {a.booking_id} · {new Date(a.created_at).toLocaleString()}</div>
      {a.status==='pending' && <div className="flex gap-2"><button disabled={busy===a.id} onClick={()=>review(a.id,'approved')} className="px-3 py-1 rounded bg-green-600 text-white text-sm">Approve</button><button disabled={busy===a.id} onClick={()=>review(a.id,'rejected')} className="px-3 py-1 rounded border text-sm">Reject</button></div>}
      {a.resolution_note && <div className="text-xs">Note: {a.resolution_note}</div>}
    </div>
  ))}
  </div>;
}
