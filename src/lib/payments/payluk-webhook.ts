import { createHmac, timingSafeEqual } from 'crypto';

/** Payluk signs the exact request body with the environment's secret key. */
export function verifyPaylukWebhookSignature(
  rawBody: Buffer | string,
  signature: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;

  const expected = createHmac('sha512', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
