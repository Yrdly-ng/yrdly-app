import { paylukEventEnvironment } from './payluk-event-finance-config';

/** New collection has its own switch; disabling it does not disable funded recovery. */
export function paylukEventCheckoutEnabled(): boolean {
  return process.env.PAYLUK_EVENT_CHECKOUT_ENABLED === 'true' &&
    paylukEventEnvironment() !== null;
}

/** Permit paid-event setup for checkout QA only; this never enables payouts. */
export function allowStagingPaidEventWithoutPayoutAccount(): boolean {
  return process.env.PAYLUK_EVENT_ALLOW_UNLINKED_PAYOUT_STAGING === 'true' &&
    process.env.QA_ENVIRONMENT === 'staging' &&
    process.env.QA_EXPECTED_PROJECT_REF === 'jxgpvvehajxegeeozlnl' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://jxgpvvehajxegeeozlnl.supabase.co' &&
    process.env.PAYLUK_SECRET_KEY?.startsWith('sk_test_') === true &&
    process.env.PAYLUK_BASE_URL === 'https://staging.api.payluk.ng' &&
    process.env.PAYLUK_EVENT_CHECKOUT_ENABLED === 'true' &&
    process.env.PAYLUK_EVENT_NATIVE_COMMISSION_CONFIRMED === 'true' &&
    process.env.PAYLUK_EVENT_WITHDRAWALS_ENABLED !== 'true';
}

/** Funding starts the provider window; rounding up can delay release, never advance it. */
export function paylukEventDeliveryDays(endTime: string, now = Date.now()): number {
  const days = Math.ceil((Date.parse(endTime) - now) / 86_400_000);
  if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error('Event is outside the supported escrow window');
  return days;
}
