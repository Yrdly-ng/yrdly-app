import type { PaylukEscrow, PaylukMilestone } from '../payments/payluk-service';
import { verifyBookingMilestoneContract } from './milestone-contract';

const kobo=(amount:number)=>{
  const value=Math.round(amount*100);
  if(!Number.isFinite(amount)||!Number.isSafeInteger(value)||value<0||Math.abs(amount*100-value)>0.000001)throw new Error('Invalid milestone settlement amount');
  return value;
};
/** Admin rulings describe the whole price; only the still-held pool may move. */
export function planBookingMilestoneRefund(input:{
  escrow:PaylukEscrow; milestones:PaylukMilestone[];
  expected:{id:string;amount:number}[]; escrowId:string; amount:number;
  refundAmount:number; sellerAmount:number;
}){
  const {escrow,milestones}=input;
  if(escrow.id!==input.escrowId||escrow.settlementType!=='MILESTONE'||escrow.state!=='OPENED'||
    !['DISPUTED','INVESTIGATING'].includes(escrow.status)||escrow.whoPays!=='buyer'||Number(escrow.additionalFee||0)!==0||kobo(escrow.amount)!==kobo(input.amount)){
    throw new Error('Milestone dispute does not match the booking');
  }
  verifyBookingMilestoneContract(milestones,input.expected);
  if(milestones.some(m=>!['PENDING','RELEASED'].includes(m.status)))throw new Error('Milestone already settled; reconciliation required');
  const principal=kobo(input.amount),buyer=kobo(input.refundAmount),seller=kobo(input.sellerAmount);
  const released=milestones.filter(m=>m.status==='RELEASED').reduce((n,m)=>n+kobo(m.amount),0);
  const held=milestones.filter(m=>m.status==='PENDING').reduce((n,m)=>n+kobo(m.amount),0);
  if(principal!==released+held||buyer+seller!==principal||seller<released||buyer>held||held===0)throw new Error('Ruling would move already-released milestone funds');
  const heldSeller=seller-released;
  return {escrowId:escrow.id,status:buyer===0?'COMPLETED' as const:heldSeller===0?'REFUNDED' as const:'SPLIT' as const,
    poolKobo:held,buyerKobo:buyer,sellerKobo:heldSeller,previouslyReleasedKobo:released,
    milestones:milestones.map(m=>({id:m.id,amountKobo:kobo(m.amount),status:m.status}))};
}
