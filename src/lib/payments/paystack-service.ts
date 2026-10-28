import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaystackVerification {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  fees: number | null;
  paid_at: string | null;
  domain: 'test' | 'live';
  metadata?: Record<string, unknown>;
}

export interface PaystackTransfer {
  domain: 'test' | 'live';
  transfer_code: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  recipient: string | { recipient_code: string };
}

export class PaystackRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly uncertain = false) {
    super(message);
  }
}

/** Defaults off; testing on the main project requires explicit opt-in. */
export function getPaystackEventMode(): 'test' | 'live' | null {
  if (process.env.PAYSTACK_EVENT_CHECKOUT_ENABLED !== 'true') return null;
  const secret = process.env.PAYSTACK_SECRET_KEY || '';
  if (secret.startsWith('sk_test_') && (process.env.VERCEL_ENV !== 'production' || process.env.PAYSTACK_TEST_ON_MAIN === 'true')) {
    const projectRef = process.env.PAYSTACK_SANDBOX_PROJECT_REF;
    try {
      const hostname = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname;
      if (projectRef && hostname === `${projectRef}.supabase.co`) return 'test';
      if (process.env.PAYSTACK_LOCAL_SANDBOX === 'true' && ['localhost', '127.0.0.1'].includes(hostname)) return 'test';
    } catch { return null; }
    return null;
  }
  if (secret.startsWith('sk_live_') && process.env.PAYSTACK_LIVE_ENABLED === 'true' &&
      process.env.PAYSTACK_MANUAL_PAYOUTS_ENABLED === 'true' && process.env.PAYSTACK_EVENT_OPERATIONS_APPROVED === 'true') return 'live';
  return null;
}

export function paystackSandboxUserAllowed(userId: string): boolean {
  if (process.env.PAYSTACK_TEST_ON_MAIN !== 'true') return true;
  if (process.env.PAYSTACK_TEST_ALLOW_ALL_USERS === 'true') return true;
  return (process.env.PAYSTACK_TEST_USER_IDS || '').split(',').map(value => value.trim()).includes(userId);
}

export function paystackKeyMode(): 'test' | 'live' {
  const key = process.env.PAYSTACK_SECRET_KEY || '';
  if (key.startsWith('sk_test_')) return 'test';
  if (key.startsWith('sk_live_')) return 'live';
  throw new PaystackRequestError('Paystack is not configured.', 503);
}

export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature) || !process.env.PAYSTACK_SECRET_KEY) return false;
  const digest = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest();
  return timingSafeEqual(digest, Buffer.from(signature, 'hex'));
}

export function nairaToKobo(amount: number): number {
  const kobo = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(kobo) ||
      Math.abs(amount * 100 - kobo) > 0.000001) throw new Error('Invalid payment amount.');
  return kobo;
}

function referencePath(reference: string): string {
  if (!/^[A-Za-z0-9._=-]{1,100}$/.test(reference)) throw new Error('Invalid Paystack reference.');
  return encodeURIComponent(reference);
}

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  paystackKeyMode();
  let response: Response;
  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      method, headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000), cache: 'no-store',
    });
  } catch {
    throw new PaystackRequestError('Paystack did not confirm the request. Check its existing reference before retrying.', 502, method !== 'GET');
  }
  let envelope: { status?: boolean; message?: string; data?: T };
  try { envelope = await response.json(); }
  catch { throw new PaystackRequestError('Paystack returned an unreadable response. Reconciliation is required.', 502, method !== 'GET'); }
  if (!response.ok || envelope.status !== true || envelope.data == null) {
    // The caller keeps reservations for uncertain mutations; no automatic retry.
    throw new PaystackRequestError(response.status === 429 ? 'Paystack is busy. Please retry later.' : 'Paystack could not confirm this request.',
      response.status === 429 ? 429 : 502, method !== 'GET' && (response.status >= 500 || response.ok));
  }
  return envelope.data;
}

/** Server-only transport. Amounts passed to Paystack are integer kobo. */
export class PaystackService {
  static initializeTransaction(input: { email: string; amountKobo: number; reference: string; callbackUrl: string; metadata: Record<string, unknown> }) {
    referencePath(input.reference);
    if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) throw new Error('Invalid payment amount.');
    return request<{ authorization_url: string; access_code: string; reference: string }>('/transaction/initialize', 'POST', {
      email: input.email, amount: String(input.amountKobo), reference: input.reference,
      callback_url: input.callbackUrl, currency: 'NGN', metadata: JSON.stringify(input.metadata),
    });
  }

  static verifyTransaction(reference: string) {
    return request<PaystackVerification>(`/transaction/verify/${referencePath(reference)}`);
  }

  static refundTransaction(input: { transaction: string; amountKobo: number; merchantNote?: string }) {
    referencePath(input.transaction);
    if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) throw new Error('Invalid refund amount.');
    return request<{ id: number; status: string; amount: number; transaction: { reference: string } | number }>('/refund', 'POST', {
      transaction: input.transaction, amount: input.amountKobo, currency: 'NGN', merchant_note: input.merchantNote,
    });
  }

  static listBanks() {
    return request<Array<{ code: string; name: string; active: boolean; currency: string }>>('/bank?country=nigeria&currency=NGN&perPage=100');
  }

  static resolveAccount(accountNumber: string, bankCode: string) {
    if (!/^\d{10}$/.test(accountNumber) || !/^\d{3,10}$/.test(bankCode)) throw new Error('Invalid Nigerian bank account.');
    return request<{ account_number: string; account_name: string; bank_id: number }>(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
  }

  static createTransferRecipient(input: { accountNumber: string; bankCode: string; name: string }) {
    if (!/^\d{10}$/.test(input.accountNumber) || !/^\d{3,10}$/.test(input.bankCode)) throw new Error('Invalid Nigerian bank account.');
    return request<{ recipient_code: string }>('/transferrecipient', 'POST', {
      type: 'nuban', name: input.name, account_number: input.accountNumber, bank_code: input.bankCode, currency: 'NGN',
    });
  }

  static initiateTransfer(input: { amountKobo: number; recipient: string; reference: string; reason: string }) {
    if (!/^[a-z0-9_-]{16,50}$/.test(input.reference)) throw new Error('Invalid transfer reference.');
    if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo < 10000 || !/^RCP_[A-Za-z0-9]+$/.test(input.recipient)) throw new Error('Invalid transfer details.');
    return request<PaystackTransfer>('/transfer', 'POST', {
      source: 'balance', amount: input.amountKobo, recipient: input.recipient, reference: input.reference, reason: input.reason, currency: 'NGN',
    });
  }

  static verifyTransfer(reference: string) {
    return request<PaystackTransfer>(`/transfer/verify/${referencePath(reference)}`);
  }

  static getBalance() {
    return request<Array<{ currency: string; balance: number }>>('/balance');
  }

  static getRefund(id: string) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid refund identifier.');
    return request<{ id: number; status: string; amount: number; currency: string; domain: 'test' | 'live'; transaction: number | { id: number; reference: string } }>(`/refund/${id}`);
  }
}
