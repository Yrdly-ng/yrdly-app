/** Environment binding is independent of new-checkout and funded-recovery controls. */
export function stagedBookingEnvironment(): 'test' | 'live' | null {
  if (process.env.PAYLUK_STAGED_COMMISSION_CONFIRMED !== 'true') return null;
  if (process.env.QA_ENVIRONMENT === 'staging' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://jxgpvvehajxegeeozlnl.supabase.co' &&
    process.env.PAYLUK_SECRET_KEY?.startsWith('sk_test_') === true &&
    process.env.PAYLUK_BASE_URL === 'https://staging.api.payluk.ng') return 'test';
  if (process.env.PAYLUK_STAGED_LIVE_APPROVED === 'true' &&
    process.env.PAYLUK_STAGED_EXPECTED_PROJECT_REF === 'yoiyqxtpmxnrrbqqidcs' &&
    ['https://yoiyqxtpmxnrrbqqidcs.supabase.co','https://api.yrdly.ng'].includes(process.env.NEXT_PUBLIC_SUPABASE_URL || '') &&
    process.env.QA_ENVIRONMENT !== 'staging' &&
    process.env.PAYLUK_SECRET_KEY?.startsWith('sk_live_') === true &&
    process.env.PAYLUK_BASE_URL === 'https://api.payluk.ng') return 'live';
  return null;
}

export function stagedBookingPaymentsEnabled(): boolean {
  return stagedBookingEnvironment() !== null && process.env.PAYLUK_STAGED_BOOKINGS_ENABLED === 'true';
}

export function stagedBookingOperationsEnabled(): boolean {
  return stagedBookingEnvironment() !== null && (process.env.PAYLUK_STAGED_BOOKINGS_ENABLED === 'true' ||
    process.env.PAYLUK_STAGED_RECOVERY_ENABLED === 'true');
}
