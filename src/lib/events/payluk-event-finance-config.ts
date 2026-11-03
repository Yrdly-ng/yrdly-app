export type PaylukEventEnvironment = 'test' | 'live';

/** Credential, provider host and database must describe the same deployment. */
export function paylukEventEnvironment(): PaylukEventEnvironment | null {
  if (process.env.PAYLUK_EVENT_NATIVE_COMMISSION_CONFIRMED !== 'true') return null;
  if (process.env.QA_ENVIRONMENT === 'staging' &&
    process.env.QA_EXPECTED_PROJECT_REF === 'jxgpvvehajxegeeozlnl' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://jxgpvvehajxegeeozlnl.supabase.co' &&
    process.env.PAYLUK_SECRET_KEY?.startsWith('sk_test_') === true &&
    process.env.PAYLUK_BASE_URL === 'https://staging.api.payluk.ng') return 'test';
  if (process.env.PAYLUK_EVENT_LIVE_APPROVED === 'true' &&
    process.env.PAYLUK_EVENT_EXPECTED_PROJECT_REF === 'yoiyqxtpmxnrrbqqidcs' &&
    ['https://yoiyqxtpmxnrrbqqidcs.supabase.co', 'https://api.yrdly.ng'].includes(process.env.NEXT_PUBLIC_SUPABASE_URL || '') &&
    process.env.QA_ENVIRONMENT !== 'staging' &&
    process.env.PAYLUK_SECRET_KEY?.startsWith('sk_live_') === true &&
    process.env.PAYLUK_BASE_URL === 'https://api.payluk.ng') return 'live';
  return null;
}

/** Legacy unbound payments keep their existing recovery path; native events must be bound. */
export function assertPaylukEventEnvironment(
  transaction: { item_type?: string; metadata?: { event_id?: unknown; payluk_fee_mode?: string; payluk_environment?: unknown } | null },
  provider?: { environment?: unknown },
) {
  if (transaction.item_type !== 'ticket' && !transaction.metadata?.event_id) return;
  const stored = transaction.metadata?.payluk_environment;
  if (stored == null && transaction.metadata?.payluk_fee_mode !== 'native_commission_v1') return;
  const current = paylukEventEnvironment();
  if (!current || stored !== current || (provider && provider.environment !== current)) {
    throw new Error('Ticket payment environment does not match this deployment.');
  }
}

export function paylukEventFinanceEnabled() {
  return process.env.PAYLUK_EVENT_FINANCE_ENABLED === 'true' &&
    paylukEventEnvironment() !== null;
}

export function paylukEventWithdrawalsEnabled() {
  return paylukEventFinanceEnabled() && process.env.PAYLUK_EVENT_WITHDRAWALS_ENABLED === 'true';
}
