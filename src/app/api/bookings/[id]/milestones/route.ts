import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { stagedBookingPaymentsEnabled, stagedBookingOperationsEnabled } from '@/lib/bookings/staged-booking-config';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401});
  const {id}=await context.params;
  const booking=await supabaseAdmin.from('bookings').select('customer_id,business_id,status,payment_flow,payment_status,agreed_price').eq('id',id).single();
  if(booking.error||!booking.data)return NextResponse.json({error:'Booking not found'},{status:404});
  const b=booking.data;
  const business=await supabaseAdmin.from('businesses').select('owner_id').eq('id',b.business_id).single();
  if(b.customer_id!==user.id&&business.data?.owner_id!==user.id)return NextResponse.json({error:'Forbidden'},{status:403});
  const enabled=stagedBookingOperationsEnabled();
  if(!enabled)return NextResponse.json({enabled:false,milestones:[],canPay:false});
  const releases=await supabaseAdmin.from('booking_milestone_releases').select('transaction_id,position,amount_kobo,status,verified_at').eq('booking_id',id).order('position');
  if(releases.error)return NextResponse.json({error:'Payment progress could not be loaded.'},{status:503});
  const rows=releases.data||[];
  let financialHold=false,settled=false;
  if(rows.length){
    const tx=await supabaseAdmin.from('escrow_transactions').select('status').eq('id',rows[0].transaction_id).single();
    if(tx.error)return NextResponse.json({error:'Payment status could not be verified.'},{status:503});
    financialHold=tx.data?.status==='disputed';
    const dispute=await supabaseAdmin.from('disputes').select('id,status').eq('transaction_id',rows[0].transaction_id).maybeSingle();
    if(dispute.error)return NextResponse.json({error:'Dispute status could not be verified.'},{status:503});
    if(dispute.data){
      const operation=await supabaseAdmin.from('dispute_resolution_operations').select('status').eq('dispute_id',dispute.data.id).maybeSingle();
      if(operation.error)return NextResponse.json({error:'Refund status could not be verified.'},{status:503});
      settled=operation.data?.status==='succeeded';
      financialHold=financialHold||(!settled&&['open','under_review'].includes(dispute.data.status));
    }
  }
  return NextResponse.json({enabled:true,financialHold,settled,canPay:stagedBookingPaymentsEnabled()&&!financialHold&&!settled&&b.customer_id===user.id&&b.status==='confirmed'&&['unpaid','failed','deposit_pending'].includes(b.payment_status),
    milestones:rows.map(({transaction_id,...m})=>({...m,status:settled&&m.status!=='released'?'settled':m.status,canApprove:!financialHold&&!settled&&b.customer_id===user.id&&['paid','completed','escrow_held','fully_paid'].includes(b.payment_status)&&
      ['pending','approving'].includes(m.status)&&(m.position===1||b.status==='completed'&&rows.some(p=>p.position===1&&p.status==='released'))}))});
}
