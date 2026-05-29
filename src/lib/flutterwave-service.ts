// Server-side only - Flutterwave service
// This service should only be used in API routes, not in client components

let flw: any = null;

// Initialize Flutterwave only on server side
if (typeof window === 'undefined') {
  if (!process.env.FLUTTERWAVE_PUBLIC_KEY || !process.env.FLUTTERWAVE_SECRET_KEY) {
    console.warn('[Yrdly] Missing FLUTTERWAVE_PUBLIC_KEY or FLUTTERWAVE_SECRET_KEY — Flutterwave features will not work.');
  } else {

  try {
    // eslint-disable-next-line
    const Flutterwave = require('flutterwave-node-v3');
    flw = new Flutterwave(
      process.env.FLUTTERWAVE_PUBLIC_KEY,
      process.env.FLUTTERWAVE_SECRET_KEY
    );
  } catch (error) {
    console.warn('Flutterwave not available:', error);
  }
  }
}


export interface PaymentInitiationData {
  transactionId: string;
  amount: number;
  buyerEmail: string;
  buyerName: string;
  itemTitle: string;
  sellerName: string;
}

export interface PaymentVerificationResult {
  success: boolean;
  transactionReference?: string;
  amount?: number;
  status?: string;
  error?: string;
}

export class FlutterwaveService {
  /**
   * Initialize payment for escrow transaction
   */
  static async initializePayment(data: PaymentInitiationData): Promise<string> {
    if (!flw) {
      throw new Error('Flutterwave service not available - this should only be called server-side');
    }

    try {
      const payload = {
        tx_ref: data.transactionId,
        amount: data.amount,
        currency: 'NGN',
        redirect_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/verify?tx_ref=${data.transactionId}`,
        payment_options: 'card,banktransfer,mobilemoney',
        customer: {
          email: data.buyerEmail,
          name: data.buyerName,
        },
        customizations: {
          title: 'Yrdly Marketplace',
          description: `Payment for ${data.itemTitle} from ${data.sellerName}`,
          logo: `${process.env.NEXT_PUBLIC_APP_URL}/yrdly-logo.png`,
        },
        meta: {
          transaction_id: data.transactionId,
          item_title: data.itemTitle,
          seller_name: data.sellerName,
        },
      };

      const response = await flw.Payment.initialize(payload);
      
      if (response.status === 'success') {
        return response.data.link;
      } else {
        throw new Error(response.message || 'Failed to initialize payment');
      }
    } catch (error) {
      console.error('Flutterwave payment initialization error:', error);
      throw new Error('Failed to initialize payment');
    }
  }

  /**
   * Verify payment transaction
   */
  static async verifyPayment(transactionReference: string): Promise<PaymentVerificationResult> {
    if (!flw) {
      throw new Error('Flutterwave service not available - this should only be called server-side');
    }

    try {
      const response = await flw.Transaction.verify({ id: transactionReference });
      
      if (response.status === 'success' && response.data.status === 'successful') {
        return {
          success: true,
          transactionReference: response.data.tx_ref,
          amount: parseFloat(response.data.amount),
          status: response.data.status,
        };
      } else {
        return {
          success: false,
          error: response.message || 'Payment verification failed',
        };
      }
    } catch (error) {
      console.error('Flutterwave payment verification error:', error);
      return {
        success: false,
        error: 'Payment verification failed',
      };
    }
  }

  /**
   * Refund a transaction
   * @param flwTransactionId The numeric transaction ID from Flutterwave (payment_reference)
   * @param amount The amount to refund (optional, if omitted refunds full amount)
   */
  static async refundTransaction(flwTransactionId: string, amount?: number): Promise<boolean> {
    if (!flw) {
      throw new Error('Flutterwave service not available');
    }

    try {
      const payload: any = { id: flwTransactionId };
      if (amount) {
        payload.amount = amount;
      }
      
      const response = await flw.Transaction.refund(payload);
      return response.status === 'success';
    } catch (error) {
      console.error('Flutterwave refund error:', error);
      return false;
    }
  }

  /**
   * Create seller subaccount for direct payouts (optional)
   */
  static async createSubaccount(sellerData: {
    accountName: string;
    email: string;
    bankCode: string;
    accountNumber: string;
  }): Promise<string> {
    if (!flw) {
      throw new Error('Flutterwave service not available');
    }

    try {
      const payload = {
        account_name: sellerData.accountName,
        email: sellerData.email,
        mobilenumber: '', // Optional
        bank_code: sellerData.bankCode,
        account_number: sellerData.accountNumber,
        business_name: sellerData.accountName,
        business_mobile: '', // Optional
        business_email: sellerData.email,
        business_contact: sellerData.accountName,
        business_contact_mobile: '', // Optional
        business_contact_email: sellerData.email,
        business_address: '', // Optional
        split_type: 'percentage',
        split_value: 0.97,
      };

      const response = await flw.Subaccount.create(payload);
      
      if (response.status === 'success') {
        return response.data.subaccount_id;
      } else if (response.message?.toLowerCase().includes('already exists')) {
        // Find existing subaccount
        const listResponse = await flw.Subaccount.fetch_all();
        if (listResponse.status === 'success' && Array.isArray(listResponse.data)) {
          const existing = listResponse.data.find(
            (s: any) => s.account_number === sellerData.accountNumber && s.account_bank === sellerData.bankCode
          );
          if (existing) {
            return existing.subaccount_id;
          }
        }
        throw new Error('Subaccount already exists but could not be retrieved');
      } else {
        throw new Error(response.message || 'Failed to create subaccount');
      }
    } catch (error) {
      console.error('Subaccount creation error:', error);
      if (error instanceof Error) throw error;
      throw new Error('Failed to create seller subaccount');
    }
  }

  /**
   * Transfer funds to seller's bank account via Flutterwave Transfer API.
   * Requires the seller's actual bank_code and account_number — NOT a subaccount ID.
   */
  static async transferToSeller(params: {
    bankCode: string;
    accountNumber: string;
    amount: number;
    reference: string;
    narration: string;
  }): Promise<{ success: boolean; error?: string }> {
    if (!flw) {
      throw new Error('Flutterwave service not available — call server-side only');
    }
    try {
      const payload = {
        account_bank: params.bankCode,
        account_number: params.accountNumber,
        amount: params.amount,
        narration: params.narration,
        currency: 'NGN',
        reference: params.reference,
        callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/transfer-callback`,
        debit_currency: 'NGN',
      };

      const response = await flw.Transfer.initiate(payload);
      
      if (response.status === 'success') {
        return { success: true };
      } else {
        return { success: false, error: response.message || 'Transfer failed' };
      }
    } catch (error: any) {
      console.error('Transfer to seller error:', error);
      return { 
        success: false, 
        error: error?.message || error?.response?.data?.message || 'Unknown transfer error' 
      };
    }
  }
}
