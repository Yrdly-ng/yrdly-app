import type { PaylukMilestone } from '../payments/payluk-service';

/** An odd kobo remains in the final payment, preserving the exact agreed price. */
export function splitBookingMilestones(amount: number): [number, number] {
  const kobo = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(kobo) || kobo < 120000 || Math.abs(amount * 100 - kobo) > 0.000001) {
    throw new Error('Invalid agreed service price');
  }
  const first = Math.floor(kobo / 2);
  return [first / 100, (kobo - first) / 100];
}

/** Reject changed/replaced milestones before using provider status as release evidence. */
export function verifyBookingMilestoneContract(
  milestones: PaylukMilestone[], expected: { id: string; amount: number }[],
): void {
  if (milestones.length !== 2 || expected.length !== 2 || new Set(expected.map(m => m.id)).size !== 2) {
    throw new Error('Service milestones require reconciliation');
  }
  for (const item of expected) {
    const found = milestones.filter(m => m.id === item.id);
    if (found.length !== 1 || !Number.isFinite(found[0].amount) ||
      Math.round(found[0].amount * 100) !== Math.round(item.amount * 100) || found[0].customerId) {
      throw new Error('Service milestone identity or beneficiary changed');
    }
  }
}
