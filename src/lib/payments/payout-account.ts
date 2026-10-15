/** Matches the 24-hour cooling period shown by payout settings. */
export function payoutAccountError(account: { is_active?: boolean; verification_status?: string; account_updated_at?: string | null } | null): string | null {
  if (!account?.is_active || account.verification_status !== 'verified') return 'Link a verified, active bank account before withdrawing.';
  if (account.account_updated_at) {
    const changedAt = Date.parse(account.account_updated_at);
    if (!Number.isFinite(changedAt) || Date.now() < changedAt + 24 * 60 * 60 * 1000) {
      return 'Withdrawals are paused for 24 hours after a bank account change.';
    }
  }
  return null;
}
