import 'server-only';
import { supabaseAdmin } from '../supabase/supabase-admin';
import { PaylukService } from '../payments/payluk-service';
import { getPaylukCustomerId } from '../payments/payluk-onboarding';
import { verifyBookingMilestoneContract, splitBookingMilestones } from './milestone-contract';
import { stagedBookingPaymentsEnabled, stagedBookingEnvironment } from './staged-booking-config';
import { BookingCheckoutError, verifyBookingCheckout } from './booking-payments';

export async function createStagedBookingCheckout(bookingId: string, buyerId: string, appointmentTime: string) {
  if (!stagedBookingPaymentsEnabled()) throw new BookingCheckoutError('Staged service checkout is not available yet. No payment has been started.',503);
  const reserved=await supabaseAdmin.rpc('reserve_staged_booking_checkout',{p_booking:bookingId,p_buyer:buyerId});
  if(reserved.error||!reserved.data)throw new BookingCheckoutError('This booking cannot be paid yet.');
  const tx=reserved.data;
  const environment=stagedBookingEnvironment();
  if(tx.metadata?.payluk_environment && tx.metadata.payluk_environment!==environment)throw new BookingCheckoutError('Booking payment environment requires review.');
  const buyer=await getPaylukCustomerId(buyerId);
  const result=()=>({transactionId:tx.id,reference:tx.payment_reference,paylukPaymentToken:tx.payluk_tx_ref,paylukEscrowId:tx.payluk_escrow_id,buyerPaylukId:buyer,amount:Number(tx.amount),commission:Number(tx.commission),paymentFee:Math.round((Number(tx.total_amount)-Number(tx.amount))*100)/100,staged:true,totalAmount:Number(tx.total_amount)});
  if(tx.payluk_tx_ref&&tx.payluk_escrow_id&&['pending','paid','completed'].includes(tx.status)){
    const remote=await PaylukService.verifyEscrow(tx.payluk_tx_ref);
    if((remote as unknown as {environment:string}).environment!==environment||remote.id!==tx.payluk_escrow_id||remote.settlementType!=='MILESTONE'||remote.whoPays!=='buyer'||Number(remote.additionalFee||0)!==0||
      Math.round(remote.amount*100)!==Math.round(Number(tx.amount)*100)||!Number.isFinite(remote.fee)||
      Math.round((remote.amount+remote.fee)*100)!==Math.round(Number(tx.total_amount)*100))throw new BookingCheckoutError('Provider checkout changed; reconciliation is required.');
    const rows=await supabaseAdmin.from('booking_milestone_releases').select('milestone_id,amount_kobo').eq('transaction_id',tx.id).order('position');
    if(rows.error||rows.data?.length!==2)throw new BookingCheckoutError('Milestone records require review.');
    verifyBookingMilestoneContract(await PaylukService.getMilestones(tx.payluk_tx_ref),rows.data.map(m=>({id:m.milestone_id,amount:Number(m.amount_kobo)/100})));
    if(['ONGOING','COMPLETED'].includes(remote.status)){
      await verifyBookingCheckout(bookingId,buyerId);return {...result(),alreadyPaid:true};
    }
    if(tx.status!=='pending'||remote.state!=='AWAITING_PAYMENT'||remote.status!=='PENDING')throw new BookingCheckoutError('Payment needs reconciliation.');
    return result();
  }
  if(tx.status!=='pending'||tx.payluk_tx_ref||tx.payluk_escrow_id)throw new BookingCheckoutError('Checkout needs reconciliation. No replacement payment was started.');
  const claimed=await supabaseAdmin.from('escrow_transactions').update({status:'creating_escrow',creating_escrow_started_at:new Date().toISOString(),metadata:{...tx.metadata,payluk_environment:environment}}).eq('id',tx.id).eq('status','pending').select('id').maybeSingle();
  if(claimed.error||!claimed.data)throw new BookingCheckoutError('Checkout is already being prepared.');
  let submitted=false;
  try{
    const seller=await getPaylukCustomerId(tx.seller_id);
    await PaylukService.updateCustomerPermissions(buyer,{canBuy:true});
    await PaylukService.updateCustomerPermissions(seller,{canSell:true});
    const amounts=splitBookingMilestones(Number(tx.amount));
    const maxDelivery=Math.ceil((Date.parse(appointmentTime)-Date.now())/86400000)+1;
    if(!Number.isInteger(maxDelivery)||maxDelivery<1||maxDelivery>365)throw new Error('Unsupported appointment window');
    submitted=true;
    const remote=await PaylukService.createMilestoneEscrow(seller,{amount:Number(tx.amount),purpose:'Service booking — two buyer-approved releases',maxDelivery,deliveryTimeline:'days',milestones:amounts.map((amount,i)=>({title:i===0?'Start service':'Service completed',amount}))});
    if((remote as unknown as {environment:string}).environment!==environment||remote.settlementType!=='MILESTONE'||remote.whoPays!=='buyer'||remote.amount!==Number(tx.amount)||Number(remote.additionalFee||0)!==0||!Number.isFinite(remote.fee)||remote.fee<Number(tx.commission)||remote.milestones?.length!==2)throw new Error('Provider milestone contract requires review');
    const rows=remote.milestones.map((m,i)=>{
      if(m.amount!==amounts[i]||m.customerId||m.status!=='PENDING')throw new Error('Provider milestone changed');
      return {booking_id:bookingId,transaction_id:tx.id,escrow_id:remote.id,milestone_id:m.id,position:i+1,amount_kobo:Math.round(m.amount*100),buyer_id:buyerId,seller_id:tx.seller_id};
    });
    const total=Math.round((remote.amount+remote.fee)*100)/100;
    const stored=await supabaseAdmin.rpc('finalize_staged_booking_checkout', {
      p_transaction:tx.id,p_escrow:remote.id,p_token:remote.paymentToken,p_fee:remote.fee,
      p_milestones:rows.map(r=>({id:r.milestone_id,amount_kobo:r.amount_kobo})),
    });
    if(stored.error||stored.data!==true)throw new Error('Could not store checkout');
    tx.payluk_escrow_id=remote.id;tx.payluk_tx_ref=remote.paymentToken;tx.total_amount=total;
    return result();
  }catch{
    await supabaseAdmin.from('escrow_transactions').update({status:submitted?'reconciling':'cancelled'}).eq('id',tx.id).eq('status','creating_escrow');
    throw new BookingCheckoutError('Checkout requires verification. No replacement payment was started.',503);
  }
}
