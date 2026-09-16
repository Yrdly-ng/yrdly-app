export type PaymentProvider = 'payluk' | 'paystack';

/** Server-side primary provider selection. Existing public variable is a compatibility fallback. */
export function getPrimaryPaymentProvider(): PaymentProvider {
  const configured = (process.env.PAYMENT_PROVIDER || process.env.NEXT_PUBLIC_PAYMENT_PROVIDER || 'payluk').trim().toLowerCase();
  return configured === 'paystack' ? 'paystack' : 'payluk';
}

export function isPaylukProvider(provider: string | null | undefined): boolean {
  return provider === 'payluk';
}

export function isPaystackProvider(provider: string | null | undefined): boolean {
  return provider === 'paystack';
}

export function assertPaymentProvider(value: string): PaymentProvider {
  if (value !== 'payluk' && value !== 'paystack') {
    throw new Error(`Unsupported payment provider: ${value}`);
  }
  return value;
}

export const PAYMENT_PROVIDER_ENV = 'PAYMENT_PROVIDER';
