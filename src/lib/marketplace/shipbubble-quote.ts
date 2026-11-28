import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const SHIPPING_URL = 'https://api.shipbubble.com/v1/shipping/';
const QA_PROJECT_URL = 'https://jxgpvvehajxegeeozlnl.supabase.co';

export function shipbubbleQuoteConfig() {
  const key = process.env.SHIPBUBBLE_API_KEY;
  const listingId = process.env.NEXT_PUBLIC_SHIPBUBBLE_QA_LISTING_ID;
  const pickupAddressCode = Number(process.env.SHIPBUBBLE_QA_PICKUP_ADDRESS_CODE);
  const categoryId = Number(process.env.SHIPBUBBLE_QA_PACKAGE_CATEGORY_ID);
  if (
    process.env.VERCEL_ENV !== 'preview' ||
    process.env.QA_ENVIRONMENT !== 'staging' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== QA_PROJECT_URL ||
    !key?.startsWith('sb_sandbox_') ||
    !listingId || !Number.isSafeInteger(pickupAddressCode) || pickupAddressCode <= 0 ||
    !Number.isSafeInteger(categoryId) || categoryId <= 0
  ) return null;
  return { key, listingId, pickupAddressCode, categoryId };
}

export type QuoteConfig = NonNullable<ReturnType<typeof shipbubbleQuoteConfig>>;
type Recipient = { name: string; email: string; phone: string; address: string };
type PackageItem = { name: string; price: number };

export class ShipbubbleQuoteError extends Error {
  constructor(public readonly reason: 'invalid_address' | 'unavailable') {
    super(reason);
  }
}

async function post<T>(key: string, path: string, data: object, isAddress = false): Promise<T> {
  const response = await fetch(SHIPPING_URL + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (isAddress && response.status === 422) throw new ShipbubbleQuoteError('invalid_address');
  if (!response.ok) throw new ShipbubbleQuoteError('unavailable');
  const envelope = await response.json();
  if (envelope.status !== 'success' || !envelope.data) throw new ShipbubbleQuoteError('unavailable');
  return envelope.data as T;
}

type PickupQuote = Record<string, unknown>;

export async function getShipbubblePickupQuote(config: QuoteConfig, recipient: Recipient, item: PackageItem) {
  const verified = await post<{ address_code: number; country_code?: string; state?: string }>(
    config.key, 'address/validate', recipient, true,
  );
  if (!Number.isSafeInteger(verified.address_code) || verified.address_code <= 0 ||
    verified.country_code !== 'NG' || verified.state?.toLowerCase() !== 'lagos') {
    throw new ShipbubbleQuoteError('invalid_address');
  }

  const pickupDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format();
  const rates = await post<{ couriers?: PickupQuote[]; request_token?: string }>(config.key, 'fetch_rates', {
    sender_address_code: config.pickupAddressCode,
    reciever_address_code: verified.address_code,
    pickup_date: pickupDate,
    category_id: config.categoryId,
    service_type: 'pickup',
    package_items: [{ name: item.name, description: 'YRDLY QA parcel', unit_weight: '0.5', unit_amount: String(item.price), quantity: '1' }],
    package_dimension: { length: 20, width: 15, height: 10 },
  });

  const quotes = (rates.couriers ?? []).flatMap(quote => {
    const amount = quote.rate_card_amount ?? quote.total;
    if (quote.service_type !== 'pickup' || quote.currency !== 'NGN' ||
      (typeof amount !== 'number' && typeof amount !== 'string') ||
      String(amount).trim() === '' || !Number.isFinite(Number(amount)) ||
      Number(amount) < 0 || Number(amount) > Number.MAX_SAFE_INTEGER / 100) return [];
    return [{
      feeKobo: Math.round(Number(amount) * 100),
      eta: typeof quote.delivery_eta === 'string' ? quote.delivery_eta.slice(0, 140) : null,
      kwik: quote.service_code === 'kwik',
      provider: typeof rates.request_token === 'string' && typeof quote.service_code === 'string' &&
        typeof quote.courier_id === 'string' && quote.courier_id ?
        { requestToken: rates.request_token, serviceCode: quote.service_code, courierId: quote.courier_id } : undefined,
    }];
  });
  return quotes.sort((a, b) => Number(b.kwik) - Number(a.kwik) || a.feeKobo - b.feeKobo)[0] ?? null;
}

export type DeliveryQuote = {
  buyerId: string;
  itemId: string;
  priceKobo: number;
  feeKobo: number;
  expiresAt: number;
  provider: { requestToken: string; serviceCode: string; courierId: string };
};

export function deliveryOperationsEnabled(config: QuoteConfig | null): config is QuoteConfig {
  return Boolean(config && process.env.PAYLUK_SECRET_KEY?.startsWith('sk_test_') &&
    process.env.PAYLUK_BASE_URL === 'https://staging.api.payluk.ng');
}

export function deliveryCheckoutEnabled(config: QuoteConfig | null): config is QuoteConfig {
  return process.env.SHIPBUBBLE_QA_PAID_DELIVERY === 'true' && deliveryOperationsEnabled(config);
}

function tokenKey(key: string) {
  return createHash('sha256').update('yrdly-shipbubble-checkout:' + key).digest();
}

export function sealDeliveryQuote(config: QuoteConfig, quote: DeliveryQuote): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(config.key), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(quote)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function readDeliveryQuote(config: QuoteConfig, token: string): DeliveryQuote | null {
  if (!/^[A-Za-z0-9_-]{40,4000}$/.test(token)) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(config.key), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as DeliveryQuote;
  } catch {
    return null;
  }
}

export async function bookShipbubbleDelivery(config: QuoteConfig, quote: DeliveryQuote) {
  const shipment = await post<{ order_id?: string; tracking_url?: string }>(config.key, 'labels', {
    request_token: quote.provider.requestToken,
    service_code: quote.provider.serviceCode,
    courier_id: quote.provider.courierId,
  });
  if (typeof shipment.order_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(shipment.order_id)) {
    throw new ShipbubbleQuoteError('unavailable');
  }
  // Sandbox can return a localhost URL. Only expose HTTPS tracking links from Shipbubble.
  let trackingUrl: string | null = null;
  try {
    const url = new URL(shipment.tracking_url ?? '');
    if (url.protocol === 'https:' && (url.hostname === 'shipbubble.com' || url.hostname.endsWith('.shipbubble.com'))) {
      trackingUrl = url.href;
    }
  } catch { /* Tracking status is still available in the order. */ }
  return { shipmentId: shipment.order_id, trackingUrl };
}
