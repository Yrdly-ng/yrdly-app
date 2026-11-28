import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const API = 'https://app.travo.ng/v1';
const quoteId = z.string().regex(/^quote_[a-zA-Z0-9_-]{1,100}$/);
const orderId = z.string().regex(/^order_[a-zA-Z0-9_-]{1,100}$/);
const amount = z.number().int().positive().max(100_000_000);
const signedQuote = z.object({
  quoteId, feeKobo: amount, itemKobo: amount, expiresAt: z.number().int(),
  itemId: z.string().uuid(), buyerId: z.string().uuid(),
});

export type TravoQuote = z.infer<typeof signedQuote>;

export function travoSettings() {
  const key = process.env.TRAVO_API_KEY;
  const listingId = process.env.NEXT_PUBLIC_TRAVO_QA_LISTING_ID;
  const pickup = process.env.TRAVO_QA_PICKUP_ADDRESS?.trim();
  const weightKg = Number(process.env.TRAVO_QA_PACKAGE_WEIGHT_KG);
  if (process.env.VERCEL_ENV !== 'preview' || process.env.QA_ENVIRONMENT !== 'staging' ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://jxgpvvehajxegeeozlnl.supabase.co' ||
      !key || !listingId || !pickup || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 50) return null;
  return { key, listingId, pickup, weightKg };
}

export type TravoSettings = NonNullable<ReturnType<typeof travoSettings>>;
export const travoCheckoutEnabled = () => process.env.TRAVO_QA_CHECKOUT_ENABLED === 'true' &&
  process.env.PAYLUK_SECRET_KEY?.startsWith('sk_test_') === true &&
  process.env.PAYLUK_BASE_URL === 'https://staging.api.payluk.ng';

function authenticate(settings: TravoSettings, payload: string) {
  return createHmac('sha256', settings.key).update('yrdly-travo-quote:' + payload).digest();
}

export function signTravoQuote(settings: TravoSettings, quote: TravoQuote) {
  const payload = Buffer.from(JSON.stringify(signedQuote.parse(quote))).toString('base64url');
  return payload + '.' + authenticate(settings, payload).toString('base64url');
}

export function readTravoQuote(settings: TravoSettings | null, token: unknown) {
  if (!settings || typeof token !== 'string' || !/^[\w-]{10,1600}\.[\w-]{43}$/.test(token)) return null;
  const [payload, signature] = token.split('.');
  if (!timingSafeEqual(authenticate(settings, payload), Buffer.from(signature, 'base64url'))) return null;
  try {
    const result = signedQuote.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

async function request(settings: TravoSettings, path: string, body: object) {
  const response = await fetch(API + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + settings.key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new TravoRequestError(response.status);
  return response.json();
}

export class TravoRequestError extends Error {
  constructor(readonly status: number) { super('Travo request failed'); }
}

const location = z.object({
  address: z.string(),
  precision: z.enum(['exact', 'street']),
  state: z.string().optional(),
  country: z.string().optional(),
});

const quotesResponse = z.object({
  addresses: z.object({ pickup: location, dropoff: location }),
  quotes: z.array(z.object({
    id: quoteId, amount, currency: z.literal('NGN'), expires_at: z.string(),
  })),
});

function verifiedLagos(address: z.infer<typeof location>) {
  const suffix = /,\s*Lagos(?: State)?\s*,\s*Nigeria\s*$/i.test(address.address);
  return (address.country ? address.country.toUpperCase() === 'NG' : suffix) &&
    (address.state ? /^Lagos(?: State)?$/i.test(address.state) : suffix);
}

export async function quoteTravoDelivery(settings: TravoSettings, dropoff: string) {
  const result = quotesResponse.safeParse(await request(settings, '/quotes', {
    pickup: settings.pickup, dropoff, weight_kg: settings.weightKg,
  }));
  if (!result.success || !verifiedLagos(result.data.addresses.pickup) || !verifiedLagos(result.data.addresses.dropoff)) return null;

  const best = result.data.quotes.filter(quote => Date.parse(quote.expires_at) > Date.now())
    .sort((a, b) => a.amount - b.amount)[0];
  if (!best) return null;
  return { quoteId: best.id, feeKobo: best.amount, expiresAt: Date.parse(best.expires_at), dropoff: result.data.addresses.dropoff.address };
}

function isTravoLink(value: string, path: string) {
  try {
    const url = new URL(value);
    return url.origin === 'https://travo.ng' && !url.username && !url.password &&
      url.pathname.startsWith(path) && url.pathname.length > path.length;
  } catch { return false; }
}

const customerQuote = z.object({
  order_id: orderId, amount, currency: z.literal('NGN'), payer: z.literal('customer'),
  quote_url: z.string().refine(url => isTravoLink(url, '/quote/')),
  tracking_url: z.string().refine(url => isTravoLink(url, '/track/')),
});

export async function sendTravoDeliveryQuote(
  settings: TravoSettings, quote: TravoQuote, reference: string, customer: { name: string; email: string; phone: string },
) {
  const result = z.object({ customer_quote: customerQuote }).parse(
    await request(settings, '/quotes/' + encodeURIComponent(quote.quoteId) + '/send', { customer, payer: 'customer', reference }),
  ).customer_quote;
  if (result.amount !== quote.feeKobo) throw new Error('Travo quote amount changed');
  return { orderId: result.order_id, paymentUrl: result.quote_url, trackingUrl: result.tracking_url };
}
