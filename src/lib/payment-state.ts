export type WithdrawalOutcome = 'success' | 'pending' | 'failed';

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
