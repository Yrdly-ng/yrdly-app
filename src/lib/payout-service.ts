import { supabaseAdmin } from './supabase-admin';
import { PaystackService } from './paystack-service';
import { NotificationService } from './notification-service';

export interface PayoutRequest {
  id: string;
  sellerId: string;
  accountId: string;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  requestedAt: Date;
  processedAt?: Date;
  failureReason?: string;
  transactionReference?: string;
}

export interface SellerBalance {
  totalEarnings: number;
  availableBalance: number;
  pendingPayouts: number;
  completedPayouts: number;
}

export class PayoutService {
  /**
   * Get seller's balance from completed transactions
   */
  static async getSellerBalance(sellerId: string): Promise<SellerBalance> {
    try {
      // Get completed transactions for this seller
      const { data: transactions, error } = await supabaseAdmin
        .from('escrow_transactions')
        .select('seller_amount, status')
        .eq('seller_id', sellerId);

      if (error) {
        console.error('Error fetching seller transactions:', error);
        throw error;
      }

      const completedTransactions = transactions?.filter(t => t.status === 'completed') || [];
      const totalEarnings = completedTransactions.reduce((sum, t) => sum + t.seller_amount, 0);

      // Get payout requests
      const { data: payouts, error: payoutError } = await supabaseAdmin
        .from('payout_requests')
        .select('amount, status')
        .eq('seller_id', sellerId);

      if (payoutError) {
        console.error('Error fetching payout requests:', payoutError);
        throw payoutError;
      }

      const completedPayouts = payouts?.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0) || 0;
      const pendingPayouts = payouts?.filter(p => p.status === 'pending' || p.status === 'processing').reduce((sum, p) => sum + p.amount, 0) || 0;

      return {
        totalEarnings,
        availableBalance: totalEarnings - completedPayouts - pendingPayouts,
        pendingPayouts,
        completedPayouts,
      };
    } catch (error) {
      console.error('Failed to get seller balance:', error);
      throw new Error('Failed to get seller balance');
    }
  }

  /**
   * Initiate automatic payout after transaction completion
   */
  static async initiateAutoPayout(transactionId: string): Promise<void> {
    try {
      // Get transaction details
      const { data: transaction, error: fetchError } = await supabaseAdmin
        .from('escrow_transactions')
        .select('seller_id, seller_amount, status')
        .eq('id', transactionId)
        .single();

      if (fetchError) {
        console.error('Error fetching transaction:', fetchError);
        throw fetchError;
      }

      if (transaction.status !== 'completed') {
        throw new Error('Transaction must be completed before payout');
      }

      // Get seller's primary account
      const { data: sellerAccount, error: accountError } = await supabaseAdmin
        .from('seller_accounts')
        .select('*')
        .eq('user_id', transaction.seller_id)
        .eq('is_primary', true)
        .eq('is_active', true)
        .single();

      if (accountError || !sellerAccount) {
        console.log('No primary seller account found, skipping auto payout');
        return;
      }

      if (sellerAccount.verification_status !== 'verified') {
        console.log('Seller account not verified, skipping auto payout');
        return;
      }

      // Create payout request
      const payoutData = {
        seller_id: transaction.seller_id,
        account_id: sellerAccount.id,
        amount: transaction.seller_amount,
        status: 'pending',
        requested_at: new Date().toISOString(),
      };

      const { data: payoutRequest, error: payoutError } = await supabaseAdmin
        .from('payout_requests')
        .insert(payoutData)
        .select('id')
        .single();

      if (payoutError) {
        console.error('Error creating payout request:', payoutError);
        throw payoutError;
      }

      // Process the payout
      await this.processPayout(payoutRequest.id);

    } catch (error) {
      console.error('Failed to initiate auto payout:', error);
      throw new Error('Failed to initiate auto payout');
    }
  }

  /**
   * Process a payout request
   */
  static async processPayout(payoutRequestId: string): Promise<void> {
    try {
      // Get payout request details
      const { data: payoutRequest, error: fetchError } = await supabaseAdmin
        .from('payout_requests')
        .select(`
          *,
          seller_account:seller_accounts(*)
        `)
        .eq('id', payoutRequestId)
        .single();

      if (fetchError) {
        console.error('Error fetching payout request:', fetchError);
        throw fetchError;
      }

      if (payoutRequest.status !== 'pending') {
        throw new Error('Payout request is not pending');
      }

      // Update status to processing
      await supabaseAdmin
        .from('payout_requests')
        .update({
          status: 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payoutRequestId);

      // Get seller account details
      const accountDetails = payoutRequest.seller_account.account_details as Record<string, string> | null;
      const accountType = payoutRequest.seller_account.account_type;

      let transferSuccess = false;
      let transferErrorMsg = 'Transfer failed';
      let transactionReference = '';

      try {
        if (accountType === 'bank_account' || accountType === 'mobile_money' || accountType === 'digital_wallet') {
          const bankCode = accountDetails?.bank_code || accountDetails?.bankCode;
          const accountNumber = accountDetails?.account_number || accountDetails?.accountNumber;

          if (!bankCode || !accountNumber) {
            throw new Error('Missing bank details for payout. Seller must re-add their account.');
          }

          const transferResult = await PaystackService.transferToSeller({
            bankCode,
            accountNumber,
            amount: payoutRequest.amount,
            reference: `payout-${payoutRequestId}`,
            narration: `Yrdly payout for transaction ${payoutRequestId}`,
          });
          
          transferSuccess = transferResult.success;
          if (!transferSuccess && transferResult.error) {
            transferErrorMsg = transferResult.error;
          }
          transactionReference = `payout-${payoutRequestId}`;
        }

        if (transferSuccess) {
          // Update payout request as completed
          await supabaseAdmin
            .from('payout_requests')
            .update({
              status: 'completed',
              transaction_reference: transactionReference,
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', payoutRequestId);

          // Send success notification
          try {
            await NotificationService.createPayoutProcessedNotification(
              payoutRequest.seller_id,
              payoutRequest.amount,
              payoutRequestId
            );
          } catch (notificationError) {
            console.error('Failed to send payout success notification:', notificationError);
          }
        } else {
          // Update payout request as failed
          await supabaseAdmin
            .from('payout_requests')
            .update({
              status: 'failed',
              failure_reason: transferErrorMsg,
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', payoutRequestId);

          // Send failure notification
          try {
            await NotificationService.createPayoutFailedNotification(
              payoutRequest.seller_id,
              payoutRequest.amount,
              transferErrorMsg,
              payoutRequestId
            );
          } catch (notificationError) {
            console.error('Failed to send payout failure notification:', notificationError);
          }
        }

      } catch (transferError) {
        console.error('Transfer error:', transferError);
        
        // Update payout request as failed
        await supabaseAdmin
          .from('payout_requests')
          .update({
            status: 'failed',
            failure_reason: transferError instanceof Error ? transferError.message : 'Unknown error',
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', payoutRequestId);

        // Send failure notification
        try {
          await NotificationService.createPayoutFailedNotification(
            payoutRequest.seller_id,
            payoutRequest.amount,
            transferError instanceof Error ? transferError.message : 'Unknown error',
            payoutRequestId
          );
        } catch (notificationError) {
          console.error('Failed to send payout failure notification:', notificationError);
        }
      }

    } catch (error) {
      console.error('Failed to process payout:', error);
      throw new Error('Failed to process payout');
    }
  }

  /**
   * Manual payout (admin triggered)
   */
  static async manualPayout(sellerId: string, amount: number, adminId: string): Promise<string> {
    try {
      // Get seller's primary account
      const { data: sellerAccount, error: accountError } = await supabaseAdmin
        .from('seller_accounts')
        .select('*')
        .eq('user_id', sellerId)
        .eq('is_primary', true)
        .eq('is_active', true)
        .single();

      if (accountError || !sellerAccount) {
        throw new Error('No active primary account found for seller');
      }

      // Create payout request
      const payoutData = {
        seller_id: sellerId,
        account_id: sellerAccount.id,
        amount: amount,
        status: 'pending',
        requested_at: new Date().toISOString(),
      };

      const { data: payoutRequest, error: payoutError } = await supabaseAdmin
        .from('payout_requests')
        .insert(payoutData)
        .select('id')
        .single();

      if (payoutError) {
        console.error('Error creating manual payout request:', payoutError);
        throw payoutError;
      }

      // Process the payout
      await this.processPayout(payoutRequest.id);

      return payoutRequest.id;
    } catch (error) {
      console.error('Failed to create manual payout:', error);
      throw new Error('Failed to create manual payout');
    }
  }

  /**
   * Get payout history for a seller
   */
  static async getSellerPayoutHistory(sellerId: string): Promise<PayoutRequest[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('payout_requests')
        .select('*')
        .eq('seller_id', sellerId)
        .order('requested_at', { ascending: false });

      if (error) {
        console.error('Error fetching payout history:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Failed to get payout history:', error);
      throw new Error('Failed to get payout history');
    }
  }

  /**
   * Get all pending payouts (admin)
   */
  static async getPendingPayouts(): Promise<PayoutRequest[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('payout_requests')
        .select(`
          *,
          seller:users(
            id,
            name,
            email
          ),
          seller_account:seller_accounts(
            account_type,
            account_details
          )
        `)
        .in('status', ['pending', 'processing'])
        .order('requested_at', { ascending: true });

      if (error) {
        console.error('Error fetching pending payouts:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Failed to get pending payouts:', error);
      throw new Error('Failed to get pending payouts');
    }
  }

  /**
   * Cancel a payout request
   */
  static async cancelPayout(payoutRequestId: string): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('payout_requests')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payoutRequestId)
        .eq('status', 'pending');

      if (error) {
        console.error('Error cancelling payout:', error);
        throw error;
      }
    } catch (error) {
      console.error('Failed to cancel payout:', error);
      throw new Error('Failed to cancel payout');
    }
  }
}
