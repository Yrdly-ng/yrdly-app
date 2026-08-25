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

const PAYLUK_SECRET_KEY = process.env.PAYLUK_SECRET_KEY;
const PAYLUK_BASE_URL =
  process.env.PAYLUK_BASE_URL || 'https://staging.api.payluk.ng';

if (typeof window === 'undefined' && !PAYLUK_SECRET_KEY) {
  console.warn('[Yrdly] Missing PAYLUK_SECRET_KEY — Payluk features will not work.');
}

// ── Standard Payluk envelope ────────────────────────────────────────────────
// Every response: { status: number, message: string, data: T }

interface PaylukEnvelope<T> {
  status: number;
  message: string;
  data: T;
}

// ── Request helpers ─────────────────────────────────────────────────────────

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
  });

  const data: PaylukEnvelope<T> = await res.json();

  if (!res.ok) {
    throw new Error(data.message || `Payluk API error: ${res.status}`);
  }

  return data;
}

async function paylukFormRequest<T>(
  endpoint: string,
  formData: FormData,
  options: { customerId?: string; method?: string } = {}
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
  });

  const data: PaylukEnvelope<T> = await res.json();

  if (!res.ok) {
    throw new Error(data.message || `Payluk API error: ${res.status}`);
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
  }): Promise<PaylukCustomer> {
    const { countryId, ...requestParams } = params;
    const response = await paylukRequest<PaylukCustomer>('/v1/customer/create', {
      method: 'POST',
      body: JSON.stringify(requestParams),
    });
    return response.data;
  }

  /**
   * GET /v1/customers?phone=...
   * Looks up a customer by phone number. If multiple matches are found, it uses the provided email to disambiguate.
   * Throws an error if ambiguity cannot be resolved. Returns null if not found.
   */
  static async getCustomerByPhone(phone: string, email?: string): Promise<PaylukCustomer | null> {
    try {
      const response = await paylukRequest<{
        pagination: any;
        data: PaylukCustomer[];
      }>(`/v1/customers?phone=${encodeURIComponent(phone)}`, {
        method: 'GET',
      });
      
      const matches = response.data?.data || [];
      
      if (matches.length === 0) {
        return null;
      }
      
      if (email) {
        const exactMatches = matches.filter(c => c.email.toLowerCase() === email.toLowerCase());
        if (exactMatches.length === 1) {
          return exactMatches[0];
        }
        throw new Error(`Found ${matches.length} customers with phone ${phone}, and ${exactMatches.length} with email ${email}. Cannot disambiguate safely.`);
      }
      
      if (matches.length === 1) {
        return matches[0];
      }
      
      throw new Error(`Found ${matches.length} customers with phone ${phone} and no email provided for disambiguation.`);
    } catch (error: any) {
      if (error.message.includes('Cannot disambiguate safely') || error.message.includes('no email provided')) {
        throw error;
      }
      console.warn(`[PaylukService] getCustomerByPhone failed for ${phone}:`, error?.message);
      return null;
    }
  }

  /**
   * GET /v1/customer/:id
   * Fetches a single customer by their Payluk customer ID.
   * Throws if the customer doesn't exist (used to verify stored IDs).
   */
  static async getCustomerById(customerId: string): Promise<PaylukCustomer> {
    const response = await paylukRequest<PaylukCustomer>(
      `/v1/customer/${encodeURIComponent(customerId)}`,
      { method: 'GET' }
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
    }
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
      customerId,
    });
    return response.data;
  }

  /**
   * POST /v1/payment/escrow
   * Funds an escrow from the buyer's Payluk wallet (or saved card).
   * amount must equal escrowAmount + buyerFeeShare + additionalFee exactly.
   * Requires customerId of the buyer.
   */
  static async payEscrow(
    customerId: string,
    params: {
      amount: number;
      reference: string;
      escrowId: string;
      gateway?: 'wallet' | 'card';
      cardId?: string;
      currency?: string;
    }
  ): Promise<{ id: string; status: string; reference: string; escrowDetails: unknown }> {
    const body: Record<string, unknown> = {
      amount: params.amount,
      reference: params.reference,
      transactionType: 'escrow',
      gateway: params.gateway || 'wallet',
      currency: params.currency || 'NGN',
      escrowDetails: {
        escrowId: params.escrowId,
      },
    };

    if (params.cardId) {
      body.cardId = params.cardId;
    }

    const response = await paylukRequest<{
      id: string;
      status: string;
      reference: string;
      escrowDetails: unknown;
    }>('/v1/payment/escrow', {
      method: 'POST',
      body: JSON.stringify(body),
      customerId,
    });

    return response.data;
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
    if (params.sellerAmount !== undefined) formData.append('sellerAmount', String(params.sellerAmount));
    if (params.buyerAmount !== undefined) formData.append('buyerAmount', String(params.buyerAmount));
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
   * POST /v1/payment/virtual-account
   * Generates a virtual account for a merchant customer.
   * Nigerian customers only. BVN on file -> dedicated permanent account;
   * no BVN -> temporary 24-hour account.
   * Requires customerId.
   */
  static async generateVirtualAccount(
    customerId: string
  ): Promise<PaylukVirtualAccount> {
    const response = await paylukRequest<PaylukVirtualAccount>(
      '/v1/payment/virtual-account',
      {
        method: 'POST',
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
    customerId: string,
    accountNumber: string,
    bankCode: string
  ): Promise<{ valid: boolean; accountName?: string; accountNumber?: string }> {
    try {
      const response = await paylukRequest<PaylukResolvedAccount>(
        '/v1/payment/verify-account',
        {
          method: 'POST',
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

      // Test-mode fallback — mirrors paystack-service.ts pattern.
      if (PAYLUK_SECRET_KEY?.startsWith('sk_test_')) {
        console.warn('[PaylukService] Test mode: resolveAccount failed, using fallback.');
        return { valid: true, accountName: 'Test Bank Account (Fallback)' };
      }

      return { valid: false };
    }
  }

  /**
   * GET /v1/wallet
   * Returns the wallet balances for a specific merchant customer.
   * Requires customerId (set as customer-id header).
   */
  static async getWallet(
    customerId: string
  ): Promise<{ mainBalance: number; escrowBalance: number; currency: string }> {
    const response = await paylukRequest<{
      id: string;
      mainBalance: number;
      escrowBalance: number;
      currency: string;
      createdAt: string;
      updatedAt: string;
    }>('/v1/wallet', {
      method: 'GET',
      customerId,
    });
    return {
      mainBalance: response.data.mainBalance,
      escrowBalance: response.data.escrowBalance,
      currency: response.data.currency,
    };
  }
}
