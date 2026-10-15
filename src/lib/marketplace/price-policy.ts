import { MIN_PAID_PRICE } from '../shared/constants';

export function isMoneyAmount(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
  const kobo = Math.round(value * 100);
  return Number.isSafeInteger(kobo) && Math.abs(value * 100 - kobo) < 0.0000001;
}

export function isPaidPrice(value: unknown): value is number {
  return isMoneyAmount(value) && value >= MIN_PAID_PRICE;
}

export const MINIMUM_PRICE_MESSAGE = `Paid prices and booking payments must be at least ₦${MIN_PAID_PRICE.toLocaleString('en-NG')}, with at most two decimal places.`;

export function servicePriceError(service: {
  price?: number | null;
  deposit_required?: boolean;
  deposit_amount?: number | null;
  deposit_percent?: number | null;
  requires_full_payment?: boolean;
  escrow_enabled?: boolean;
}): string | null {
  if (service.price != null && (!isMoneyAmount(service.price) || (service.price > 0 && !isPaidPrice(service.price)))) {
    return MINIMUM_PRICE_MESSAGE;
  }
  if (service.deposit_amount != null && !isMoneyAmount(service.deposit_amount)) return 'Enter a valid deposit amount with at most two decimal places.';
  if (service.deposit_percent != null && (!Number.isInteger(service.deposit_percent) || service.deposit_percent < 0 || service.deposit_percent > 100)) {
    return 'Deposit percentage must be a whole number between 0 and 100.';
  }
  // Escrow/full payment takes priority over deposit settings, as in checkout.
  if (service.deposit_required && !service.escrow_enabled && !service.requires_full_payment) {
    const amount = service.deposit_amount && service.deposit_amount > 0 ? service.deposit_amount
      : service.deposit_percent && service.price ? Math.round(service.price * service.deposit_percent) / 100
      : service.price;
    if (!isPaidPrice(amount)) return `Booking deposit: ${MINIMUM_PRICE_MESSAGE}`;
  }
  return null;
}
