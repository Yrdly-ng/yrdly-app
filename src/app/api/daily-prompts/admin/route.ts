import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { lagosPromptClock } from '@/lib/daily-prompts/daily-prompt-clock';
import { STARTER_DAILY_QUESTIONS } from '@/lib/daily-prompts/editorial-queue';

const categories = new Set(['neighbourhood','businesses','food','services','events','community']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;

async function authorised(request: Request) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return { user: null, status: 401 };
  const result = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).single();
  if (result.error || result.data?.is_admin !== true) return { user: null, status: 403 };
  return { user, status: 200 };
}

export async function GET(request: NextRequest) {
  const auth = await authorised(request);
  if (!auth.user) return NextResponse.json({ error: 'Forbidden' }, { status: auth.status });
  const { data, error } = await supabaseAdmin.from('daily_prompts').select('*')
    .order('prompt_date', { ascending:true }).limit(90);
  if (error) return NextResponse.json({ error: 'Could not load editorial queue' }, { status: 503 });
  return NextResponse.json({ prompts: data });
}

export async function POST(request: NextRequest) {
  const auth = await authorised(request);
  if (!auth.user) return NextResponse.json({ error: 'Forbidden' }, { status: auth.status });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return NextResponse.json({ error:'Invalid action' },{ status:400 });
  if (body.action === 'seed') {
    if (!validDate(body.startDate) || body.startDate <= lagosPromptClock().date)
      return NextResponse.json({ error:'Choose a future starting date' },{ status:400 });
    const rows = STARTER_DAILY_QUESTIONS.map((q,index) => {
      const date=new Date(body.startDate+'T00:00:00Z');
      date.setUTCDate(date.getUTCDate()+index);
      return {prompt_date:date.toISOString().slice(0,10),
        question:q.question,category:q.category,status:'draft',created_by:auth.user.id,
        push_title:'Today on YRDLY',push_body:q.question};
    });
    const result=await supabaseAdmin.from('daily_prompts').insert(rows).select('id');
    if(result.error) return NextResponse.json({
      error:result.error.code==='23505' ? 'One or more dates already have questions' : 'Could not create the draft queue',
    },{status:result.error.code==='23505'?409:503});
    return NextResponse.json({created:result.data?.length??0},{status:201});
  }
  if (body.action === 'create') {
    if (!validDate(body.date) || typeof body.question !== 'string' ||
        body.question.trim().length < 12 || body.question.trim().length > 300 ||
        !categories.has(body.category ?? 'neighbourhood') ||
        (body.pushTitle != null && (typeof body.pushTitle !== 'string' || body.pushTitle.length < 3 || body.pushTitle.length > 90)) ||
        (body.pushBody != null && (typeof body.pushBody !== 'string' || body.pushBody.length < 3 || body.pushBody.length > 220))) {
      return NextResponse.json({ error: 'Invalid question or date' },{ status:400 });
    }
    const { data, error } = await supabaseAdmin.from('daily_prompts').insert({
      prompt_date:body.date,question:body.question.trim(),category:body.category ?? 'neighbourhood',
      push_title:body.pushTitle ?? null,push_body:body.pushBody ?? null,
      status:'draft',created_by:auth.user.id,
    }).select('id,prompt_date,status').single();
    if(error) return NextResponse.json({ error:error.code === '23505' ? 'Date already has a question' : 'Could not create draft' },{ status:error.code==='23505'?409:503 });
    return NextResponse.json({ prompt:data },{ status:201 });
  }
  if (!uuid.test(body.id ?? '')) return NextResponse.json({ error:'Invalid question' },{ status:400 });
  if (body.action === 'edit') {
    if (typeof body.question !== 'string' || body.question.trim().length < 12 ||
      body.question.trim().length > 300 || !categories.has(body.category ?? 'neighbourhood'))
      return NextResponse.json({ error:'Invalid editorial question' },{status:400});
    const { data,error }=await supabaseAdmin.from('daily_prompts')
      .update({question:body.question.trim(),category:body.category ?? 'neighbourhood',
        push_title:typeof body.pushTitle==='string' ? body.pushTitle.slice(0,90) : null,
        push_body:typeof body.pushBody==='string' ? body.pushBody.slice(0,220) : null,
        updated_at:new Date().toISOString()})
      .eq('id',body.id).eq('status','draft').select('id,prompt_date,status').maybeSingle();
    if(error) return NextResponse.json({ error:'Could not edit question' },{status:503});
    if(!data) return NextResponse.json({error:'Only drafts can be edited'},{status:409});
    return NextResponse.json({prompt:data});
  }
  if (body.action === 'approve') {
    // Only drafts may become approved. Approval never bypasses the 07:00 WAT gate.
    const { data, error } = await supabaseAdmin.from('daily_prompts')
      .update({ status:'approved',approved_by:auth.user.id,updated_at:new Date().toISOString() })
      .eq('id',body.id).eq('status','draft').select('id,prompt_date,status').maybeSingle();
    if(error) return NextResponse.json({ error:'Could not approve question' },{ status:503 });
    if(!data) return NextResponse.json({ error:'Only drafts can be approved' },{ status:409 });
    return NextResponse.json({ prompt:data });
  }
  if (body.action === 'pause') {
    const { data, error } = await supabaseAdmin.from('daily_prompts')
      .update({ status:'paused',updated_at:new Date().toISOString() })
      .eq('id',body.id).eq('status','approved').select('id,prompt_date,status').maybeSingle();
    if(error) return NextResponse.json({ error:'Could not pause question' },{ status:503 });
    if(!data) return NextResponse.json({ error:'Question is not active' },{ status:409 });
    return NextResponse.json({ prompt:data });
  }
  return NextResponse.json({ error:'Unknown action' },{ status:400 });
}
