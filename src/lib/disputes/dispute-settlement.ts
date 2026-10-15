import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PaylukService, type PaylukEscrow } from '@/lib/payments/payluk-service';
import { paylukAmountsMatch } from '@/lib/payments/payment-state';

type Transaction = { id: string; amount: number; commission: number; payluk_escrow_id: string; payluk_tx_ref: string; metadata?: { payluk_fee_mode?: string } };
type Operation = { id: string; refund_amount: number; seller_amount: number; provider_plan?: SettlementPlan | null };
export type SettlementPlan = {
  escrowId: string; status: 'COMPLETED' | 'REFUNDED' | 'SPLIT';
  principal: number; fee: number; whoPays: string; additionalFee: number;
  additionalFeeRefundable: boolean; pool: number; buyerAmount: number; sellerAmount: number;
};

function kobo(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
    throw new Error('Settlement amounts must be non-negative numbers with at most two decimal places.');
  }
  return Math.round(value * 100);
}

/** Gross ruling percentages divide the actual fee-adjusted pool; commission is separate. */
export function planDisputeSettlement(transaction: Transaction, operation: Operation, escrow: PaylukEscrow): SettlementPlan {
  if (escrow.id !== transaction.payluk_escrow_id || escrow.settlementType !== 'STANDARD' ||
      !paylukAmountsMatch(transaction, escrow)) throw new Error('Payluk escrow does not match the saved transaction.');
  const gross = kobo(Number(transaction.amount));
  const refund = kobo(Number(operation.refund_amount));
  const seller = kobo(Number(operation.seller_amount));
  if (!gross || refund + seller !== gross) throw new Error('Gross ruling must equal the transaction price.');
  const principal = kobo(escrow.amount), fee = kobo(escrow.fee), additionalFee = kobo(escrow.additionalFee ?? 0);
  if (fee > principal || !['buyer', 'seller', 'both'].includes(escrow.whoPays)) throw new Error('Invalid Payluk fee allocation.');
  if (escrow.whoPays === 'both' && fee % 2) throw new Error('Fractional shared fee requires reconciliation.');
  const sellerFee = escrow.whoPays === 'seller' ? fee : escrow.whoPays === 'both' ? Math.round(fee / 2) : 0;
  const pool = principal - sellerFee;
  if (pool <= 0) throw new Error('No held funds are available for settlement.');
  const buyerAmount = Number((BigInt(pool) * BigInt(refund) * BigInt(2) + BigInt(gross)) / (BigInt(gross) * BigInt(2)));
  const status = refund === 0 ? 'COMPLETED' : seller === 0 ? 'REFUNDED' : 'SPLIT';
  if (status === 'SPLIT' && (!buyerAmount || buyerAmount === pool)) throw new Error('The split is too small after fees.');
  return { escrowId: escrow.id, status, principal: principal / 100, fee: fee / 100, whoPays: escrow.whoPays,
    additionalFee: additionalFee / 100, additionalFeeRefundable: status !== 'COMPLETED', pool: pool / 100,
    buyerAmount: buyerAmount / 100, sellerAmount: (pool - buyerAmount) / 100 };
}

export async function saveDisputePlan(transaction: Transaction, operation: Operation): Promise<SettlementPlan> {
  if (!transaction.payluk_tx_ref) throw new Error('Missing Payluk payment token.');
  const escrow = await PaylukService.verifyEscrow(transaction.payluk_tx_ref);
  const plan = planDisputeSettlement(transaction, operation, escrow);
  if (!['DISPUTED', 'INVESTIGATING'].includes(escrow.status)) throw new Error('Payluk dispute is not awaiting a resolution.');
  const { data, error } = await supabaseAdmin.rpc('save_payluk_dispute_plan', { p_operation_id: operation.id, p_plan: plan });
  if (error || !data) throw new Error('Could not save the Payluk settlement plan.');
  return data as SettlementPlan;
}

/** A provider read or signed callback must prove the allocation before crediting proceeds. */
export async function applyDisputeSettlement(transactionId: string, escrow: PaylukEscrow): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('apply_payluk_dispute_settlement', {
    p_transaction_id: transactionId,
    p_settlement: {
      escrowId: escrow.id, status: escrow.status, principal: escrow.amount, fee: escrow.fee,
      whoPays: escrow.whoPays, additionalFee: escrow.additionalFee ?? 0,
      additionalFeeRefundable: escrow.additionalFeeRefundable,
      ...(escrow.split ? { pool: escrow.split.pool, buyerAmount: escrow.split.buyerAmount, sellerAmount: escrow.split.sellerAmount } : {}),
    },
  });
  if (error) throw new Error('Payluk settlement does not match the saved ruling; reconciliation is required.');
  return data === true;
}
