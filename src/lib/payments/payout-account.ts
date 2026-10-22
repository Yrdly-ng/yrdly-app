/** Verified, active bank accounts can receive payouts immediately after a change. */
export function payoutAccountError(account: { is_active?: boolean; verification_status?: string; account_updated_at?: string | null } | null): string | null {
  if (!account?.is_active || account.verification_status !== 'verified') return 'Link a verified, active bank account before withdrawing.';
  return null;
}
