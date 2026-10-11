export type WithdrawalOutcome = 'success' | 'pending' | 'failed';

interface PaylukAmountRecord {
  amount: number | string;
  commission?: number | string | null;
  metadata?: { payluk_fee_mode?: string } | null;
}

/** Ticket prices include organizer-paid commission; legacy principals stay unchanged. */
export function paylukEscrowPrincipal(transaction: PaylukAmountRecord): number {
  const amount = Number(transaction.amount);
  if (transaction.metadata?.payluk_fee_mode !== 'seller_commission_v1') return amount;
  const commission = Number(transaction.commission);
  if (!Number.isFinite(amount) || !Number.isFinite(commission) || commission < 0 || commission > amount) {
    throw new Error('Invalid stored escrow amounts');
  }
  return Math.round((amount - commission) * 100) / 100;
}

export function paylukAmountsMatch(transaction: PaylukAmountRecord, escrow: { amount: number; additionalFee?: number; whoPays?: string }): boolean {
  const expected = paylukEscrowPrincipal(transaction);
  if (!Number.isFinite(expected) || !Number.isFinite(escrow.amount) || Math.round(escrow.amount * 100) !== Math.round(expected * 100)) return false;
  return transaction.metadata?.payluk_fee_mode !== 'seller_commission_v1' ||
    (escrow.whoPays === 'seller' && Number.isFinite(escrow.additionalFee) &&
      Math.round(Number(escrow.additionalFee) * 100) === Math.round(Number(transaction.commission) * 100));
}

export function paymentReferenceFilter(reference: string, columns: readonly string[]): string {
  if (typeof reference !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(reference)) throw new Error('Invalid payment reference');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
  return columns.filter(column => column !== 'id' || uuid).map(column => `${column}.eq.${reference}`).join(',');
}

/** Payluk's payment ledger documents success, failed and reversed. Unknown stays pending. */
export function withdrawalOutcome(status: unknown): WithdrawalOutcome {
  const normalized = typeof status === 'string' ? status.toLowerCase() : '';
  if (normalized === 'success') return 'success';
  if (normalized === 'failed' || normalized === 'reversed') return 'failed';
  return 'pending';
}

export const ESCROW_ALLOWED_FROM = {
  paid: ['pending', 'creating_escrow', 'reconciling'],
  completed: ['paid', 'shipped', 'delivered'],
  disputed: ['paid', 'shipped', 'delivered'],
  cancelled: ['pending', 'creating_escrow', 'reconciling', 'paid', 'shipped', 'delivered', 'disputed'],
} as const;
