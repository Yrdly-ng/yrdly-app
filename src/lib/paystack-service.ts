// Server-side only - Paystack service
// This service should only be used in API routes, not in client components

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

if (typeof window === 'undefined' && !PAYSTACK_SECRET_KEY) {
  console.warn('[Yrdly] Missing PAYSTACK_SECRET_KEY — Paystack features will not work.');
}

async function paystackRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('Paystack service not available - PAYSTACK_SECRET_KEY is not set');
  }

  const res = await fetch(`${PAYSTACK_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || `Paystack API error: ${res.status}`);
  }

  return data;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface PaymentInitiationData {
  transactionId: string;
  amount: number; // in NGN (will be converted to kobo)
  buyerEmail: string;
  buyerName: string;
  itemTitle: string;
  sellerName: string;
  callbackUrl?: string;
  metadata?: Record<string, any>;
}

export interface PaymentVerificationResult {
  success: boolean;
  transactionReference?: string;
  amount?: number;
  status?: string;
  error?: string;
  metadata?: any;
}

// ── Service ────────────────────────────────────────────────────────────────

export class PaystackService {
  /**
   * Initialize payment for escrow transaction.
   * Returns the hosted checkout URL.
   */
  static async initializePayment(data: PaymentInitiationData): Promise<string> {
    const callback_url = data.callbackUrl || `${process.env.NEXT_PUBLIC_APP_URL}/payment/verify?tx_ref=${data.transactionId}`;

    const response = await paystackRequest<{ status: boolean; data: { authorization_url: string } }>(
      '/transaction/initialize',
      {
        method: 'POST',
        body: JSON.stringify({
          reference: data.transactionId,
          amount: Math.round(data.amount * 100), // convert NGN → kobo
          email: data.buyerEmail,
          currency: 'NGN',
          callback_url,
          channels: ['card', 'bank', 'ussd', 'bank_transfer'],
          metadata: {
            ...data.metadata,
            buyer_name: data.buyerName,
            item_title: data.itemTitle,
            seller_name: data.sellerName,
            transaction_id: data.transactionId,
            custom_fields: [
              { display_name: 'Item', variable_name: 'item_title', value: data.itemTitle },
              { display_name: 'Seller', variable_name: 'seller_name', value: data.sellerName },
            ],
          },
        }),
      }
    );

    if (!response.status || !response.data?.authorization_url) {
      throw new Error('Failed to initialize payment');
    }

    return response.data.authorization_url;
  }

  /**
   * Verify a payment transaction by reference.
   */
  static async verifyPayment(reference: string): Promise<PaymentVerificationResult> {
    try {
      const response = await paystackRequest<{
        status: boolean;
        data: { status: string; reference: string; amount: number; requested_amount?: number; metadata: any };
      }>(`/transaction/verify/${encodeURIComponent(reference)}`);

      if (response.status && response.data.status === 'success') {
        return {
          success: true,
          transactionReference: response.data.reference,
          amount: (response.data.requested_amount || response.data.amount) / 100, // convert kobo → NGN
          status: response.data.status,
          metadata: response.data.metadata,
        };
      }

      return { success: false, error: 'Payment verification failed or not successful' };
    } catch (error: any) {
      console.error('[PaystackService] verifyPayment error:', error);
      return { success: false, error: error?.message || 'Payment verification failed' };
    }
  }

  /**
   * Refund a transaction.
   * @param transactionReference The Paystack transaction reference string
   * @param amount Optional partial refund amount in NGN
   */
  static async refundTransaction(transactionReference: string, amount?: number): Promise<boolean> {
    try {
      const body: Record<string, any> = { transaction: transactionReference };
      if (amount) {
        body.amount = Math.round(amount * 100); // convert NGN → kobo
      }

      const response = await paystackRequest<{ status: boolean }>('/refund', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return response.status === true;
    } catch (error) {
      console.error('[PaystackService] refundTransaction error:', error);
      return false;
    }
  }

  /**
   * Transfer funds to a seller's bank account.
   * Paystack requires creating a "transfer recipient" first, then initiating the transfer.
   */
  static async transferToSeller(params: {
    bankCode: string;
    accountNumber: string;
    amount: number; // in NGN
    reference: string;
    narration: string;
    accountName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      // Step 1: Create a transfer recipient
      const recipientResponse = await paystackRequest<{
        status: boolean;
        data: { recipient_code: string };
      }>('/transferrecipient', {
        method: 'POST',
        body: JSON.stringify({
          type: 'nuban',
          currency: 'NGN',
          bank_code: params.bankCode,
          account_number: params.accountNumber,
          name: params.accountName || 'Yrdly Seller',
        }),
      });

      if (!recipientResponse.status || !recipientResponse.data?.recipient_code) {
        return { success: false, error: 'Failed to create transfer recipient' };
      }

      const recipientCode = recipientResponse.data.recipient_code;

      // Step 2: Initiate the transfer
      const transferResponse = await paystackRequest<{ status: boolean; message?: string }>(
        '/transfer',
        {
          method: 'POST',
          body: JSON.stringify({
            source: 'balance',
            reason: params.narration,
            amount: Math.round(params.amount * 100), // convert NGN → kobo
            recipient: recipientCode,
            reference: params.reference,
            currency: 'NGN',
          }),
        }
      );

      if (transferResponse.status) {
        return { success: true };
      }

      return { success: false, error: transferResponse.message || 'Transfer failed' };
    } catch (error: any) {
      console.error('[PaystackService] transferToSeller error:', error);
      return { success: false, error: error?.message || 'Unknown transfer error' };
    }
  }

  /**
   * Resolve (verify) a bank account number before onboarding a seller.
   * Returns the account name if valid.
   */
  static async resolveAccount(
    accountNumber: string,
    bankCode: string
  ): Promise<{ valid: boolean; accountName?: string }> {
    try {
      const response = await paystackRequest<{
        status: boolean;
        data: { account_name: string; account_number: string };
      }>(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);

      if (response.status && response.data?.account_name) {
        return { valid: true, accountName: response.data.account_name };
      }

      // In test mode, Paystack may return an unsuccessful resolve for valid accounts.
      if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
        console.warn('[PaystackService] Test mode: resolveAccount returned invalid, using fallback.');
        return { valid: true, accountName: 'Test Bank Account (Fallback)' };
      }

      return { valid: false };
    } catch (error: any) {
      console.error('[PaystackService] resolveAccount error:', error);
      
      // In test mode, Paystack limits or blocks live bank account resolutions.
      // Fall back gracefully to unblock sandbox testing.
      if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
        console.warn('[PaystackService] Test mode: resolveAccount failed, using fallback.');
        return { valid: true, accountName: 'Test Bank Account (Fallback)' };
      }
      
      return { valid: false };
    }
  }
}
