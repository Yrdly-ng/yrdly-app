/** Wire contract shared by payout history and the owner-only receipt endpoint. */
export interface PayoutReceipt {
  id: string;
  sellerId: string;
  accountId: string;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  requestedAt: string | null;
  processedAt: string | null;
  failureReason: string | null;
  transactionReference: string | null;
  bankName: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  destinationSource: 'snapshot' | 'linked_account_unchanged' | 'unavailable';
  accountName: string | null;
  fee: number | null;
  netAmount: number | null;
}
const text = (...values: unknown[]): string | null => values.find((v): v is string => typeof v === 'string' && v.trim().length > 0) || null;
const money = (value: unknown): number | null => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function payoutDate(...values: unknown[]): string | null {
  for (const value of values) {
    if (!(value instanceof Date) && (typeof value !== 'string' || !value.trim())) continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}
export function formatPayoutDate(value: unknown): string {
  const date = payoutDate(value);
  return date ? new Date(date).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date unavailable';
}
export function payoutAccountSnapshot(account: Record<string, unknown> | null | undefined) {
  const number = text(account?.account_number, account?.accountNumber);
  return {
    bankName: text(account?.bank_name, account?.bankName, account?.bank),
    bankCode: text(account?.bank_code, account?.bankCode),
    accountName: text(account?.account_name, account?.accountName),
    accountNumber: number ? `•••• ${number.replace(/\D/g, '').slice(-4)}` : null,
  };
}
export function toPayoutReceipt(row: Record<string, any>): PayoutReceipt {
  const snapshot = row.receipt_snapshot || {};
  const savedAccount = payoutAccountSnapshot(snapshot);
  const requestedAt = payoutDate(row.requested_at, row.requestedAt, row.created_at, row.createdAt);
  const linkedAccount = row.seller_account;
  const linkedUpdatedAt = payoutDate(linkedAccount?.account_updated_at, linkedAccount?.updated_at);
  const linkedAccountWasUnchanged = !!requestedAt && !!linkedUpdatedAt &&
    Date.parse(linkedUpdatedAt) <= Date.parse(requestedAt);
  const linkedDetails = linkedAccountWasUnchanged
    ? payoutAccountSnapshot(linkedAccount?.account_details)
    : payoutAccountSnapshot(null);
  const hasSavedDestination = !!(savedAccount.bankName || savedAccount.bankCode || savedAccount.accountName || savedAccount.accountNumber);
  const hasLinkedDestination = !!(linkedDetails.bankName || linkedDetails.bankCode || linkedDetails.accountName || linkedDetails.accountNumber);
  const account = {
    bankName: savedAccount.bankName ?? linkedDetails.bankName,
    bankCode: savedAccount.bankCode ?? linkedDetails.bankCode,
    accountName: savedAccount.accountName ?? linkedDetails.accountName,
    accountNumber: savedAccount.accountNumber ?? linkedDetails.accountNumber,
  };
  return {
    id: row.id, sellerId: row.seller_id ?? row.sellerId, accountId: row.account_id ?? row.accountId,
    amount: money(row.amount) ?? 0, status: row.status,
    requestedAt,
    processedAt: payoutDate(row.processed_at, row.processedAt, row.completed_at),
    failureReason: text(row.failure_reason, row.failureReason),
    transactionReference: text(row.transaction_reference, row.transactionReference),
    ...account, fee: money(snapshot.fee), netAmount: money(snapshot.netAmount),
    destinationSource: hasSavedDestination ? 'snapshot' : hasLinkedDestination ? 'linked_account_unchanged' : 'unavailable',
  };
}
