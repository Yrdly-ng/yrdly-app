import { isTransientPaylukFailure, paylukRateLimitDelay, paylukRetryAfterSeconds, payoutRateLimitMessage } from './payluk-rate-limit';
import { withdrawalOutcome, type WithdrawalOutcome } from './payment-state';
// Server-side only - Payluk service
// This service should only be used in API routes, not in client components.
//
// Base URLs:
//   Staging:    https://staging.api.payluk.ng  (sk_test_… keys)
//   Production: https://api.payluk.ng          (sk_live_… keys)
//
// Auth: Bearer token in Authorization header.
// Many routes additionally require a `customer-id` header identifying the
// merchant customer acting as buyer or seller.

import { getPaylukCustomerId } from './payluk-onboarding';

const PAYLUK_SECRET_KEY = process.env.PAYLUK_SECRET_KEY;
const PAYLUK_BASE_URL =
  process.env.PAYLUK_BASE_URL ||
  (PAYLUK_SECRET_KEY?.startsWith('sk_live_')
    ? 'https://api.payluk.ng'
    : 'https://staging.api.payluk.ng');

if (typeof window === 'undefined' && !PAYLUK_SECRET_KEY) {
  console.warn('[Yrdly] Missing PAYLUK_SECRET_KEY — Payluk features will not work.');
}

// ── Standard Payluk envelope ────────────────────────────────────────────────
// Every response: { status: number, message: string, data: T }

interface PaylukEnvelope<T> {
  status: number | boolean;
  message: string;
  data: T;
}

// ── Request helpers ─────────────────────────────────────────────────────────

export class PaylukRequestError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly providerStatus: number | boolean, readonly providerMessage: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'PaylukRequestError';
  }
}

async function paylukRequest<T>(
  endpoint: string,
  options: RequestInit & { customerId?: string } = {}
): Promise<PaylukEnvelope<T>> {
  if (!PAYLUK_SECRET_KEY) {
    throw new Error('Payluk service not available - PAYLUK_SECRET_KEY is not set');
  }

  const { customerId, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${PAYLUK_SECRET_KEY}`,
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (customerId) {
    headers['customer-id'] = customerId;
  }

  const res = await fetch(`${PAYLUK_BASE_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
    signal: fetchOptions.signal || AbortSignal.timeout(10_000),
  });

  let data: PaylukEnvelope<T>;
  let rawBody: string | undefined;
  try {
    rawBody = await res.text();
    data = JSON.parse(rawBody) as PaylukEnvelope<T>;
  } catch {
    if (res.status === 429) throw new PaylukRequestError('Payluk request rate limit reached', 429, 429, 'Too many requests', paylukRateLimitDelay(res.headers));
    throw new PaylukRequestError(
      `[Payluk] ${fetchOptions.method || 'GET'} ${endpoint} — HTTP ${res.status}: non-JSON response`,
      res.status, res.status, 'Non-JSON response'
    );
  }

  if (!res.ok) {
    const errMsg = data.message || data.status?.toString() || 'Payluk API error';
    throw new PaylukRequestError(
      `[Payluk] ${fetchOptions.method || 'GET'} ${endpoint} — HTTP ${res.status}` +
      ` (Payluk status: ${data.status}): ${errMsg}`,
      res.status, data.status, errMsg, res.status === 429 ? paylukRateLimitDelay(res.headers) : undefined,
    );
  }

  return data;
}

async function paylukFormRequest<T>(
  endpoint: string,
  formData: FormData,
  options: { customerId?: string; method?: string; signal?: AbortSignal } = {}
): Promise<PaylukEnvelope<T>> {
  if (!PAYLUK_SECRET_KEY) {
    throw new Error('Payluk service not available - PAYLUK_SECRET_KEY is not set');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${PAYLUK_SECRET_KEY}`,
  };

  if (options.customerId) {
    headers['customer-id'] = options.customerId;
  }

  const res = await fetch(`${PAYLUK_BASE_URL}${endpoint}`, {
    method: options.method || 'POST',
    body: formData,
    headers,
    signal: options.signal || AbortSignal.timeout(10_000),
  });

  let data: PaylukEnvelope<T>;
  let rawBody: string | undefined;
  try {
    rawBody = await res.text();
    data = JSON.parse(rawBody) as PaylukEnvelope<T>;
  } catch {
    throw new Error(
      `[Payluk] ${options.method || 'POST'} ${endpoint} — HTTP ${res.status}: non-JSON response`
    );
  }

  if (!res.ok) {
    const errMsg = data.message || data.status?.toString() || 'Payluk API error';
    throw new Error(
      `[Payluk] ${options.method || 'POST'} ${endpoint} — HTTP ${res.status}` +
      ` (Payluk status: ${data.status}): ${errMsg}`
    );
  }

  return data;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface PaylukCustomer {
  customerId: string;
  firstname: string;
  lastname: string;
  email: string;
  phone: string;
  bvn: string | null;
  status: string;
  blockedReason: string | null;
  blockedAt: string | null;
  createdAt: string;
  dob: string | null;
  permissions: {
    canWithdraw: boolean;
    canBuy: boolean;
    canSell: boolean;
  };
  countryId: string;
}

export type PaylukEscrowStatus =
  | 'PENDING'
  | 'ONGOING'
  | 'COMPLETED'
  | 'REFUNDED'
  | 'CLAIMED'
  | 'DISPUTED'
  | 'INVESTIGATING'
  | 'SPLIT';

export type PaylukEscrowState = 'AWAITING_PAYMENT' | 'OPENED' | 'CLOSED';

export type PaylukWhoPays = 'buyer' | 'seller' | 'both';

export interface PaylukMilestone {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  dueDate: string | null;
  customerId: string | null;
  status: 'PENDING' | 'RELEASED' | 'REFUNDED' | 'SPLIT';
  releasedAt: string | null;
}

export interface PaylukEscrow {
  id: string;
  amount: number;
  purpose: string;
  description: string | null;
  whoPays: PaylukWhoPays;
  imageUrl: string[] | null;
  fee: number;
  additionalFee: number;
  additionalFeeRefundable: boolean;
  paymentToken: string;
  paidAt: string | null;
  status: PaylukEscrowStatus;
  state: PaylukEscrowState;
  channel: string;
  isSeller: boolean;
  dispute: unknown[] | null;
  category: unknown | null;
  completedAt: string | null;
  maxDelivery: number | null;
  deliveryTimeline: string | null;
  totalQuantity: number;
  settlementType: 'STANDARD' | 'MILESTONE' | 'VAULT';
  milestones: PaylukMilestone[];
  createdAt: string;
  updatedAt: string;
  split?: { sellerAmount: number; buyerAmount: number; pool: number; resolvedAt: string };
}

export interface PaylukVirtualAccount {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  bank: string;
  dedicated: boolean;
  expiresIn?: string;
  amount?: number;
}

export interface PaylukBank {
  name: string;
  code: string;
}

export interface PaylukResolvedAccount {
  accountName: string;
  accountNumber: string;
  bankCode: string;
}

export type PaylukDisputeResolutionStatus = 'COMPLETED' | 'REFUNDED' | 'SPLIT';

interface PaylukWithdrawalIntent {
  amount: number;
  fee: number;
  reference: string;
}

const PAYLUK_WITHDRAWAL_MINIMUM = 1000;

function withdrawalMinimumError(fee = 0) {
  const minimumBudget = Math.round((PAYLUK_WITHDRAWAL_MINIMUM + fee) * 100) / 100;
  return {
    success: false as const,
    intentFee: fee,
    maximumWithdrawable: 0,
    minimumDebit: minimumBudget,
    minimumBankAmount: PAYLUK_WITHDRAWAL_MINIMUM,
    error: `The bank transfer must be at least ₦${PAYLUK_WITHDRAWAL_MINIMUM.toLocaleString()} after Payluk's fee.`,
    reason: `With the quoted fee of ₦${fee.toLocaleString()}, your balance deduction must be at least ₦${minimumBudget.toLocaleString()}.`,
  };
}

function withdrawalNet(budget: number, fee: number): number {
  return Math.max(0, (Math.round(budget * 100) - Math.round(fee * 100)) / 100);
}

async function createPaylukWithdrawalIntent(params: {
  customerId: string;
  amount: number;
  reference: string;
  bankCode: string;
  bankName?: string;
  accountNumber: string;
  accountName?: string;
}): Promise<PaylukWithdrawalIntent> {
  const response = await paylukRequest<PaylukWithdrawalIntent>('/v1/payment/create-intent', {
    method: 'POST',
    customerId: params.customerId,
    body: JSON.stringify({
      amount: params.amount,
      reference: params.reference,
      transactionType: 'withdrawal',
      currency: 'NGN',
      withdrawalDetails: {
        bankCode: params.bankCode,
        bankName: params.bankName || 'Bank',
        accountNumber: params.accountNumber,
        ...(params.accountName ? { accountName: params.accountName } : {}),
      },
    }),
  });

  const intent = response?.data;
  if (
    !intent ||
    typeof intent.amount !== 'number' || !Number.isFinite(intent.amount) || intent.amount !== params.amount ||
    typeof intent.fee !== 'number' || !Number.isFinite(intent.fee) || intent.fee < 0 ||
    typeof intent.reference !== 'string' || !intent.reference
  ) {
    throw new Error('Payluk create-intent response is invalid or missing required fee/amount fields.');
  }

  return intent;
}

/** Stage at most three intents; only the caller may execute the final one. */
async function stageBudgetedWithdrawal(params: Parameters<typeof createPaylukWithdrawalIntent>[0]): Promise<
  { intent: PaylukWithdrawalIntent; minimumError?: never } |
  { intent?: never; minimumError: ReturnType<typeof withdrawalMinimumError> & { reference: string } }
> {
  // Payluk can require amount + fee to fit the wallet even when only staging.
  // Quoting the full debit budget as a bank amount leaves no room for that fee.
  const minimumIntent = await createPaylukWithdrawalIntent({
    ...params,
    amount: PAYLUK_WITHDRAWAL_MINIMUM,
    reference: `${params.reference}-quote`,
  });
  let intent = minimumIntent;
  let netAmount = withdrawalNet(params.amount, intent.fee);
  if (netAmount < PAYLUK_WITHDRAWAL_MINIMUM) {
    return { minimumError: { ...withdrawalMinimumError(intent.fee), reference: intent.reference } };
  }
  if (netAmount === intent.amount) return { intent };

  intent = await createPaylukWithdrawalIntent({ ...params, amount: netAmount, reference: `${params.reference}-net` });
  if (intent.amount + intent.fee > params.amount) {
    // A returned fee can change with the amount. Adjust once, then the caller
    // checks the final debit. An opaque provider rejection stops staging;
    // neither fee guesses nor transfer retries are safe substitutes for a quote.
    netAmount = withdrawalNet(params.amount, intent.fee);
    if (netAmount < PAYLUK_WITHDRAWAL_MINIMUM) {
      return { minimumError: { ...withdrawalMinimumError(intent.fee), reference: intent.reference } };
    }
    intent = netAmount === minimumIntent.amount
      ? minimumIntent
      : await createPaylukWithdrawalIntent({ ...params, amount: netAmount, reference: `${params.reference}-net-adjusted` });
  }
  return { intent };
}

// ── Service ─────────────────────────────────────────────────────────────────

export class PaylukService {
  /**
   * POST /v1/customer/create
   * Creates a buyer or seller under the merchant account.
   * Requires a merchant super-admin API key.
   * Supplying a BVN yields a dedicated permanent virtual account;
   * omitting it yields a temporary 24-hour account.
   */
  static async createCustomer(params: {
    firstname: string;
    lastname: string;
    email: string;
    phone?: string;
    countryId?: string;
    bvn?: string;
  }, signal?: AbortSignal): Promise<PaylukCustomer> {
    const response = await paylukRequest<PaylukCustomer>('/v1/customer/create', {
      method: 'POST',
      signal,
      body: JSON.stringify(params),
    });
    return response.data;
  }

  /**
   * PUT /v1/customer/permissions/{customerId}
   * Sets canBuy / canSell / canWithdraw for a merchant customer.
   * Per Payluk docs: sellers need canSell, buyers need canBuy, or payment is rejected.
   * Safe to call every time — idempotent.
   */
  static async updateCustomerPermissions(
    customerId: string,
    permissions: { canBuy?: boolean; canSell?: boolean; canWithdraw?: boolean },
    signal?: AbortSignal
  ): Promise<PaylukCustomer> {
    const response = await paylukRequest<PaylukCustomer>(
      `/v1/customer/permissions/${encodeURIComponent(customerId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(permissions), signal,
      }
    );
    return response.data;
  }

  /**
   * GET /v1/customers?phone=...
   * Looks up a customer by phone number. If multiple matches are found, it uses the provided email to disambiguate.
   * Throws an error if ambiguity cannot be resolved. Returns null if not found.
   */
  static async getCustomerByPhone(phone: string, email?: string, signal?: AbortSignal): Promise<PaylukCustomer | null> {
    let response: PaylukEnvelope<{ data: PaylukCustomer[] }>;
    try {
      response = await paylukRequest<{ data: PaylukCustomer[] }>(
        `/v1/customers?phone=${encodeURIComponent(phone)}`, { method: 'GET', signal });
    } catch (error) {
      // Verified sandbox absence response. All other provider failures remain errors.
      if (error instanceof PaylukRequestError && error.httpStatus === 400 &&
          error.providerStatus === false && error.providerMessage === 'No customer found with the provided phone') return null;
      throw error;
    }
    const normalized = (value: string) => value.replace(/\D/g, '').replace(/^234/, '0');
    const matches = (response.data?.data || []).filter(customer =>
      normalized(customer.phone || '') === normalized(phone) &&
      (!email || customer.email?.toLowerCase() === email.toLowerCase()));
    if (matches.length > 1) throw new Error('Ambiguous verified payment identity. Contact support.');
    return matches[0] || null;
  }

  /**
   * GET /v1/customer/get/{customerId}
   * Fetches a single customer by their Payluk customer ID.
   * Throws if the customer doesn't exist (used to verify stored IDs).
   */
  static async getCustomerById(customerId: string, signal?: AbortSignal): Promise<PaylukCustomer> {
    const response = await paylukRequest<PaylukCustomer>(
      `/v1/customer/get/${encodeURIComponent(customerId)}`,
      { method: 'GET', signal }
    );
    return response.data;
  }

  /**
   * GET /v1/customers?email=...
   * Looks up a customer by email address. Returns null if not found.
   * Throws an error if multiple customers match the exact email address.
   */
  static async getCustomerByEmail(email: string): Promise<PaylukCustomer | null> {
    try {
      const response = await paylukRequest<{
        pagination: any;
        data: PaylukCustomer[];
      }>(`/v1/customers?email=${encodeURIComponent(email)}`, {
        method: 'GET',
      });

      const matches = response.data?.data || [];
      if (matches.length === 0) return null;

      const exactMatches = matches.filter(c => c.email.toLowerCase() === email.toLowerCase());
      if (exactMatches.length === 1) {
        return exactMatches[0];
      }
      if (exactMatches.length === 0) {
        return null;
      }

      throw new Error(`Found ${exactMatches.length} customers matching email ${email}. Cannot disambiguate safely.`);
    } catch (error: any) {
      if (error.message.includes('Cannot disambiguate safely')) {
        throw error;
      }
      console.warn(`[PaylukService] getCustomerByEmail failed for ${email}:`, error?.message);
      return null;
    }
  }

  /**
   * Fallback: pages through GET /v1/customers and manually searches for a
   * customer matching either phone or email. Used when Payluk's search API
   * returns empty despite the customer existing (staging bug workaround).
   *
   * Scans all pages to ensure no customer is missed, and enforces email disambiguation
   * and ambiguity checks before accepting a match.
   */
  static async findCustomerByPhoneOrEmailScan(phone: string, email?: string): Promise<PaylukCustomer | null> {
    try {
      let page = 1;
      const allCustomers: PaylukCustomer[] = [];

      while (true) {
        const response = await paylukRequest<{
          pagination: { count: number; pages: number; isLastPage: boolean; nextPage: number | null };
          data: PaylukCustomer[];
        }>(`/v1/customers?limit=50&page=${page}`, { method: 'GET' });

        const customers = response.data?.data || [];
        allCustomers.push(...customers);

        if (response.data?.pagination?.isLastPage || customers.length === 0) break;
        page++;
      }

      const normalizePhone = (p: string) => p.replace(/\D/g, '').slice(-10);
      const searchPhone10 = normalizePhone(phone);

      const phoneMatches = allCustomers.filter(
        c => c.phone && normalizePhone(c.phone) === searchPhone10
      );

      const emailMatches = email
        ? allCustomers.filter(c => c.email.toLowerCase() === email.toLowerCase())
        : [];

      // 1. If we have exact email match(es)
      if (emailMatches.length > 0) {
        if (emailMatches.length === 1) {
          // Verify it doesn't conflict with a different phone match
          if (
            phoneMatches.length > 0 &&
            !phoneMatches.some(p => p.customerId === emailMatches[0].customerId)
          ) {
            throw new Error(
              `Found customer ${emailMatches[0].customerId} matching email ${email}, but phone ${phone} matched a different customer ${phoneMatches[0].customerId}. Cannot disambiguate safely.`
            );
          }
          return emailMatches[0];
        }
        throw new Error(
          `Found ${emailMatches.length} customers matching email ${email} during scan. Cannot disambiguate safely.`
        );
      }

      // 2. If no email match, evaluate phone matches
      if (phoneMatches.length === 0) {
        return null;
      }

      if (phoneMatches.length === 1) {
        return phoneMatches[0];
      }

      // Multiple phone matches and no email match to resolve them
      throw new Error(
        `Found ${phoneMatches.length} customers matching phone ${phone} during scan, and no email match for ${email} to disambiguate.`
      );
    } catch (error: any) {
      if (error.message.includes('Cannot disambiguate safely') || error.message.includes('matched a different customer')) {
        throw error;
      }
      console.warn(`[PaylukService] findCustomerByPhoneOrEmailScan failed:`, error?.message);
      return null;
    }
  }

  /**
   * Scans all customers to find one matching by firstname + lastname.
   * Last-resort recovery when phone and email have both changed since the
   * customer was originally created on Payluk.
   */
  static async findCustomerByNameScan(firstname: string, lastname: string): Promise<PaylukCustomer | null> {
    try {
      let page = 1;
      const allCustomers: PaylukCustomer[] = [];

      while (true) {
        const response = await paylukRequest<{
          pagination: { count: number; pages: number; isLastPage: boolean; nextPage: number | null };
          data: PaylukCustomer[];
        }>(`/v1/customers?limit=50&page=${page}`, { method: 'GET' });

        const customers = response.data?.data || [];
        allCustomers.push(...customers);

        if (response.data?.pagination?.isLastPage || customers.length === 0) break;
        page++;
      }

      const nameMatches = allCustomers.filter(
        c =>
          c.firstname.toLowerCase() === firstname.toLowerCase() &&
          c.lastname.toLowerCase() === lastname.toLowerCase()
      );

      if (nameMatches.length === 1) {
        console.log(`[PaylukService] findCustomerByNameScan: found ${nameMatches[0].customerId} for ${firstname} ${lastname}`);
        return nameMatches[0];
      }

      if (nameMatches.length > 1) {
        console.warn(`[PaylukService] findCustomerByNameScan: found ${nameMatches.length} customers matching name ${firstname} ${lastname}. Cannot disambiguate.`);
        return null;
      }

      return null;
    } catch (error: any) {
      console.warn(`[PaylukService] findCustomerByNameScan failed:`, error?.message);
      return null;
    }
  }

  /**
   * POST /v1/escrow/create  (multipart/form-data)
   * Generates a standard escrow payment link.
   * The seller is identified by customerId (customer-id header).
   * Merchants cannot create an escrow for themselves via the API.
   */
  static async createEscrow(
    customerId: string,
    params: {
      amount: number;
      purpose: string;
      whoPays: PaylukWhoPays;
      description?: string;
      maxDelivery: number;
      deliveryTimeline: 'minutes' | 'hours' | 'days';
      totalQuantity?: number;
      categoryId?: string;
    },
    signal?: AbortSignal
  ): Promise<PaylukEscrow> {
    const formData = new FormData();
    formData.append('amount', String(params.amount));
    formData.append('purpose', params.purpose);
    formData.append('whoPays', params.whoPays);
    if (params.description) formData.append('description', params.description);
    if (params.maxDelivery !== undefined) formData.append('maxDelivery', String(params.maxDelivery));
    if (params.deliveryTimeline) formData.append('deliveryTimeline', params.deliveryTimeline);
    if (params.totalQuantity !== undefined) formData.append('totalQuantity', String(params.totalQuantity));
    if (params.categoryId) formData.append('categoryId', params.categoryId);

    const response = await paylukFormRequest<PaylukEscrow>('/v1/escrow/create', formData, {
      customerId, signal,
    });
    return response.data;
  }

  /**
   * PUT /v1/escrow/additional-fee/{paymentToken}
   * Adds Yrdly's buyer-paid commission to an unpaid escrow.
   */
  static async addAdditionalFee(
    paymentToken: string,
    additionalFee: number,
    signal?: AbortSignal
  ): Promise<PaylukEscrow> {
    const response = await paylukRequest<PaylukEscrow>(
      `/v1/escrow/additional-fee/${encodeURIComponent(paymentToken)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ additionalFee }), signal,
      }
    );
    return response.data;
  }


  /**
   * GET /v1/escrow/verify/{paymentToken}
   * Resolves an escrow by its payment token.
   * Used by a buyer or system to inspect a payment link before or after paying.
   * Does NOT send customer-id header.
   */
  static async verifyEscrow(
    paymentToken: string
  ): Promise<PaylukEscrow> {
    const response = await paylukRequest<PaylukEscrow>(
      `/v1/escrow/verify/${encodeURIComponent(paymentToken)}`,
      {
        method: 'GET',
      }
    );
    return response.data;
  }

  /** Alias for backward compatibility */
  static async getEscrowDetails(
    _customerId: string,
    paymentToken: string
  ): Promise<PaylukEscrow> {
    return this.verifyEscrow(paymentToken);
  }

  /**
   * POST /v1/escrow/confirm-payment/{escrowId}
   * Buyer confirms delivery on a standard escrow.
   * Releases the full amount to the seller; escrow closes as COMPLETED.
   * Requires customerId of the buyer.
   */
  static async confirmDelivery(
    customerId: string,
    escrowId: string
  ): Promise<PaylukEscrow> {
    const response = await paylukRequest<PaylukEscrow>(
      `/v1/escrow/confirm-payment/${escrowId}`,
      {
        method: 'POST',
        customerId,
      }
    );
    return response.data;
  }

  /**
   * GET /v1/escrow/claim-funds/{paymentToken}
   * Seller requests release of funds after the delivery window has elapsed.
   * Escrow must be OPENED. Requires customerId of the seller.
   */
  static async claimFunds(
    customerId: string,
    paymentToken: string
  ): Promise<PaylukEscrow> {
    const response = await paylukRequest<PaylukEscrow>(
      `/v1/escrow/claim-funds/${paymentToken}`,
      {
        method: 'GET',
        customerId,
      }
    );
    return response.data;
  }

  /**
   * POST /v1/escrow/submit-dispute/{paymentToken} (multipart/form-data).
   * The buyer opens the provider dispute; the seller may use the same route to reply.
   */
  static async submitDispute(
    customerId: string,
    paymentToken: string,
    message: string,
    attachment?: { blob: Blob; filename: string },
  ): Promise<PaylukEscrow> {
    const formData = new FormData();
    formData.append('message', message);
    if (attachment) formData.append('file', attachment.blob, attachment.filename);
    const response = await paylukFormRequest<PaylukEscrow>(
      `/v1/escrow/submit-dispute/${encodeURIComponent(paymentToken)}`,
      formData,
      { customerId },
    );
    return response.data;
  }

  /**
   * POST /v1/escrow/dispute/resolve/{escrowId}  (multipart/form-data)
   * Merchant resolves a dispute.
   *   COMPLETED -> releases funds to seller
   *   REFUNDED  -> returns funds to buyer
   *   SPLIT     -> divides held funds; sellerAmount + buyerAmount required
   *
   * MUST NOT send a customer-id header — merchant-only route.
   */
  static async resolveDispute(
    escrowId: string,
    params: {
      resolution: string;
      status: PaylukDisputeResolutionStatus;
      sellerAmount?: number;
      buyerAmount?: number;
      additionalFeeRefundable?: boolean;
    }
  ): Promise<PaylukEscrow> {
    const formData = new FormData();
    formData.append('resolution', params.resolution);
    formData.append('status', params.status);
    // Payluk rejects allocation fields on full refund/release resolutions.
    if (params.status === 'SPLIT') {
      if (params.sellerAmount !== undefined) formData.append('sellerAmount', String(params.sellerAmount));
      if (params.buyerAmount !== undefined) formData.append('buyerAmount', String(params.buyerAmount));
    }
    if (params.additionalFeeRefundable !== undefined) {
      formData.append('additionalFeeRefundable', String(params.additionalFeeRefundable));
    }

    // Do NOT pass customerId — merchant-only route.
    const response = await paylukFormRequest<PaylukEscrow>(
      `/v1/escrow/dispute/resolve/${escrowId}`,
      formData
    );
    return response.data;
  }

  /**
   * DELETE /v1/escrow/delete/{paymentToken}
   * Cancels/deletes an escrow that is in AWAITING_PAYMENT state.
   * Requires customerId of the seller.
   */
  static async deleteEscrow(
    customerId: string,
    paymentToken: string
  ): Promise<PaylukEscrow> {
    const response = await paylukRequest<PaylukEscrow>(
      `/v1/escrow/delete/${paymentToken}`,
      {
        method: 'DELETE',
        customerId,
      }
    );
    return response.data;
  }


  /**
   * GET /v1/payment/bank-list
   * Returns banks available for payout with their provider-specific codes.
   * Codes are opaque strings — do not hardcode or cache across sessions.
   */
  static async getBankList(): Promise<PaylukBank[]> {
    const response = await paylukRequest<PaylukBank[]>('/v1/payment/bank-list', {
      method: 'GET',
    });
    return response.data;
  }

  /**
   * POST /v1/payment/verify-account
   * Resolves an account name by account number + bank code.
   * Fetch bank codes from getBankList(); do not cache across sessions.
   * Requires customerId of the requesting customer.
   */
  static async resolveAccount(
    customerIdOrUserId: string,
    accountNumber: string,
    bankCode: string
  ): Promise<{ valid: boolean; accountName?: string; accountNumber?: string }> {
    try {
      let customerId = customerIdOrUserId;
      if (customerIdOrUserId && (customerIdOrUserId.includes('-') || customerIdOrUserId.length > 24)) {
        try {
          customerId = await getPaylukCustomerId(customerIdOrUserId);
        } catch (e) {
          console.warn('[PaylukService] Failed to get customer ID for user:', customerIdOrUserId);
        }
      }

      const response = await paylukRequest<PaylukResolvedAccount>(
        '/v1/payment/verify-account',
        {
          method: 'POST',
          // Bank-list codes are opaque and vary by provider/environment.
          body: JSON.stringify({ accountNumber, bankCode }),
          customerId,
        }
      );

      if (response.data?.accountName) {
        return {
          valid: true,
          accountName: response.data.accountName,
          accountNumber: response.data.accountNumber,
        };
      }

      return { valid: false };
    } catch (error: any) {
      console.error('[PaylukService] resolveAccount error:', error);

      return { valid: false };
    }
  }

  /**
   * Fetch merchant customer wallet details from Payluk API.
   * Explicitly distinguishes mainBalance from escrowBalance.
   */
  static async getCustomerWallet(sellerPaylukCustomerId: string): Promise<{
    mainBalance: number;
    escrowBalance: number;
    currency: string;
  }> {
    const response = await paylukRequest<any>(
      '/v1/wallet',
      {
        method: 'GET',
        customerId: sellerPaylukCustomerId,
      }
    );
    const data = response?.data || response;
    const mainBal = data?.mainBalance ?? data?.availableBalance ?? data?.wallet?.mainBalance ?? data?.main_balance ?? data?.available_balance ?? data?.balance ?? 0;
    const escrowBal = data?.escrowBalance ?? data?.wallet?.escrowBalance ?? data?.escrow_balance ?? 0;
    const curr = data?.currency || 'NGN';
    return {
      mainBalance: typeof mainBal === 'number' ? mainBal : Number(mainBal) || 0,
      escrowBalance: typeof escrowBal === 'number' ? escrowBal : Number(escrowBal) || 0,
      currency: curr,
    };
  }

  /**
   * Stage a withdrawal intent on Payluk to inspect actual live data.fee BEFORE verification.
   * Does NOT call verify — no money is moved during preview.
   */
  static async previewWithdrawal(params: {
    sellerPaylukCustomerId: string;
    amount: number;
    bankCode: string;
    bankName?: string;
    accountNumber: string;
    accountName?: string;
    reference: string;
    yrdlyAvailableBalance?: number;
  }): Promise<{
    success: boolean;
    reference?: string;
    intentAmount?: number;
    intentFee?: number;
    totalPaylukDebit?: number;
    maximumWithdrawable?: number;
    minimumDebit?: number;
    minimumBankAmount?: number;
    error?: string;
    reason?: string;
    retryAfterSeconds?: number;
  }> {
    try {
      if (!Number.isFinite(params.amount) || !Number.isSafeInteger(Math.round(params.amount*100)) ||
          Math.abs(params.amount*100-Math.round(params.amount*100))>0.000001) {
        return { success:false,reference:params.reference,error:'Enter a valid withdrawal amount with at most two decimal places.' };
      }
      if (params.amount < PAYLUK_WITHDRAWAL_MINIMUM) return { ...withdrawalMinimumError(),reference:params.reference };
      const wallet = await this.getCustomerWallet(params.sellerPaylukCustomerId);
      const paylukMainBalance = wallet.mainBalance ?? 0;

      const effectiveAvailableBalance = params.yrdlyAvailableBalance !== undefined
        ? Math.min(params.yrdlyAvailableBalance, paylukMainBalance)
        : paylukMainBalance;

      if (params.amount > effectiveAvailableBalance) {
        return {
          success: false,
          reference: params.reference,
          intentAmount: params.amount,
          error: `Requested amount (₦${params.amount.toLocaleString()}) exceeds available balance (₦${effectiveAvailableBalance.toLocaleString()}).`,
          reason: `Requested amount (₦${params.amount.toLocaleString()}) exceeds available balance (₦${effectiveAvailableBalance.toLocaleString()}).`,
        };
      }

      const staged = await stageBudgetedWithdrawal({
        customerId: params.sellerPaylukCustomerId,
        amount: params.amount,
        reference: params.reference,
        bankCode: params.bankCode,
        bankName: params.bankName,
        accountNumber: params.accountNumber,
        accountName: params.accountName,
      });
      if (staged.minimumError) return staged.minimumError;
      const intent = staged.intent;
      const totalPaylukDebit = intent.amount + intent.fee;

      const intentAmount = intent.amount;
      const intentFee = intent.fee;
      const intentRef = intent.reference;

      if (totalPaylukDebit > params.amount || totalPaylukDebit > effectiveAvailableBalance) {
        const spendLimit = Math.min(params.amount, effectiveAvailableBalance);
        const maximumWithdrawable = Math.max(0, Math.floor((spendLimit - intentFee) * 100) / 100);
        const reasonMsg = `Your requested balance deduction is ₦${params.amount.toLocaleString()}. Payluk's fee for the bank transfer is ₦${intentFee.toLocaleString()}. The amount to send to the bank must be no more than ₦${maximumWithdrawable.toLocaleString()}.`;
        return {
          success: false,
          reference: intentRef,
          intentAmount,
          intentFee,
          totalPaylukDebit,
          maximumWithdrawable,
          error: 'Withdrawal amount plus Payluk fee exceeds available balance.',
          reason: reasonMsg,
        };
      }

      return {
        success: true,
        reference: intentRef,
        intentAmount,
        intentFee,
        totalPaylukDebit,
        maximumWithdrawable: intentAmount,
      };
    } catch (err: any) {
      console.error('[PaylukService] previewWithdrawal error:', err);
      return {
        success: false,
        reference: params.reference,
        error: paylukRetryAfterSeconds(err) ? payoutRateLimitMessage(paylukRetryAfterSeconds(err)!) : err.message || 'Failed to preview withdrawal',
        retryAfterSeconds: paylukRetryAfterSeconds(err),
      };
    }
  }

  /**
   * Withdraw funds from a seller's Payluk customer wallet to their Nigerian bank account.
   * Two-step flow:
   * 1. POST /v1/payment/create-intent (transactionType: "withdrawal")
   *    Returns data.amount, data.fee, data.reference, data.status.
   * 2. Strict validation: totalPaylukDebit = data.amount + data.fee.
   *    If totalPaylukDebit > availableBalance: DO NOT verify. Return fee details & maxWithdrawable.
   * 3. POST /v1/payment/verify using exact returned reference ONLY IF totalPaylukDebit <= availableBalance.
   */
  static async getWalletBalance(customerId: string): Promise<number | null> {
    const response = await paylukRequest<any>('/v1/wallet', {
      method: 'GET',
      customerId,
    });
    const data = response.data ?? {};
    const balance = Number(data.availableBalance ?? data.available_balance ?? data.balance);
    return Number.isFinite(balance) ? balance : null;
  }

  static async getWithdrawalStatus(customerId: string, reference: string): Promise<WithdrawalOutcome> {
    const response = await paylukRequest<any>(`/v1/payment/history?reference=${encodeURIComponent(reference)}`, { customerId, method: 'GET' });
    const entries = Array.isArray(response.data) ? response.data : response.data?.data;
    if (!Array.isArray(entries)) throw new Error('Invalid Payluk reconciliation response');
    const matches = entries.filter((entry: any) => entry.reference === reference && entry.transactionType === 'withdrawal');
    if (matches.length !== 1) return 'pending';
    return withdrawalOutcome(matches[0].status);
  }

  static async withdrawToBank(params: {
    sellerPaylukCustomerId: string;
    amount: number;
    bankCode: string;
    bankName?: string;
    accountNumber: string;
    accountName?: string;
    reference: string;
    yrdlyAvailableBalance?: number;
    onIntentReady: (reference: string, quote: { amount: number; fee: number }) => Promise<void>;
  }): Promise<{
    outcome: WithdrawalOutcome;
    success: boolean;
    reference?: string;
    intentAmount?: number;
    intentFee?: number;
    totalPaylukDebit?: number;
    maximumWithdrawable?: number;
    error?: string;
    reason?: string;
    paylukStatus?: string;
    retryAfterSeconds?: number;
    transientFailure?: boolean;
  }> {
    let executionStarted = false;
    let activeReference = params.reference;
    try {
      if (!Number.isFinite(params.amount) || !Number.isSafeInteger(Math.round(params.amount*100)) ||
          Math.abs(params.amount*100-Math.round(params.amount*100))>0.000001) {
        return { outcome:'failed',success:false,reference:params.reference,error:'Enter a valid withdrawal amount with at most two decimal places.' };
      }
      if (params.amount < PAYLUK_WITHDRAWAL_MINIMUM) return { ...withdrawalMinimumError(),outcome:'failed',reference:params.reference };

      // 1. Fetch seller's Payluk wallet to check mainBalance (ignoring escrowBalance for withdrawals)
      const wallet = await this.getCustomerWallet(params.sellerPaylukCustomerId);
      const paylukMainBalance = wallet.mainBalance ?? 0;

      const effectiveAvailableBalance = params.yrdlyAvailableBalance !== undefined
        ? Math.min(params.yrdlyAvailableBalance, paylukMainBalance)
        : paylukMainBalance;

      // If requested amount already exceeds effective available balance, reject before staging
      if (params.amount > effectiveAvailableBalance) {
        return {
          outcome: 'failed',
          success: false,
          reference: params.reference,
          intentAmount: params.amount,
          error: `Requested amount (₦${params.amount.toLocaleString()}) exceeds available balance (₦${effectiveAvailableBalance.toLocaleString()}).`,
          reason: `Requested amount (₦${params.amount.toLocaleString()}) exceeds available balance (₦${effectiveAvailableBalance.toLocaleString()}).`,
        };
      }

      const staged = await stageBudgetedWithdrawal({
        customerId: params.sellerPaylukCustomerId,
        amount: params.amount,
        reference: params.reference,
        bankCode: params.bankCode,
        bankName: params.bankName,
        accountNumber: params.accountNumber,
        accountName: params.accountName,
      });
      if (staged.minimumError) return { ...staged.minimumError, outcome: 'failed' };
      const intent = staged.intent;
      const totalPaylukDebit = intent.amount + intent.fee;

      const spendLimit = Math.min(params.amount, effectiveAvailableBalance);
      if (totalPaylukDebit > spendLimit) {
        const maximumWithdrawable = Math.max(0, Math.floor((spendLimit - intent.fee) * 100) / 100);
        return {
          outcome: 'failed',
          success: false,
          reference: intent.reference,
          intentAmount: intent.amount,
          intentFee: intent.fee,
          totalPaylukDebit,
          maximumWithdrawable,
          error: 'Withdrawal amount plus Payluk fee exceeds the requested balance deduction.',
          reason: `Your requested balance deduction is ₦${params.amount.toLocaleString()}. Payluk's fee is ₦${intent.fee.toLocaleString()}; the bank transfer would be ₦${intent.amount.toLocaleString()} and debit ₦${totalPaylukDebit.toLocaleString()}. Please try again with a lower amount.`,
        };
      }

      const activeIntentAmount = intent.amount;
      const activeIntentFee = intent.fee;
      const activeIntentRef = intent.reference;

      activeReference = activeIntentRef;
      await params.onIntentReady(activeIntentRef, { amount: activeIntentAmount, fee: activeIntentFee });
      executionStarted = true;

      // 6. Execute / verify payment intent (totalPaylukDebit <= effectiveAvailableBalance)
      const verifyResponse = await paylukRequest<any>(
        '/v1/payment/verify',
        {
          method: 'POST',
          customerId: params.sellerPaylukCustomerId,
          body: JSON.stringify({ reference: activeIntentRef }),
        }
      );

      const outcome = withdrawalOutcome(verifyResponse?.data?.status);
      return {
        outcome, success: outcome === 'success', reference: activeIntentRef,
        intentAmount: activeIntentAmount, intentFee: activeIntentFee, totalPaylukDebit,
        maximumWithdrawable: activeIntentAmount,
        ...(outcome === 'success' ? {} : { error: outcome === 'pending' ? 'Transfer pending; do not submit another withdrawal.' : 'Transfer failed.' }),
        paylukStatus: String(verifyResponse?.data?.status || 'unknown'),
      };
    } catch (err: any) {
      console.error('[PaylukService] withdrawToBank error:', err);
      return {
        outcome: executionStarted ? 'pending' : 'failed',
        success: false,
        reference: activeReference,
        error: executionStarted ? 'Transfer outcome is uncertain; reconcile this payout before retrying.' : paylukRetryAfterSeconds(err) ? payoutRateLimitMessage(paylukRetryAfterSeconds(err)!) : err.message || 'Withdrawal request failed',
        retryAfterSeconds: executionStarted ? undefined : paylukRetryAfterSeconds(err),
        transientFailure: !executionStarted && isTransientPaylukFailure(err),
      };
    }
  }

}
