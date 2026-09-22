import { supabaseAdmin } from './supabase-admin';
import { PaystackService } from './paystack-service';
import { PaylukService } from './payluk-service';
import { getPaylukCustomerId } from './payluk-onboarding';
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
      // Auto-cleanup stale pending/processing payout requests older than 5 minutes
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      await supabaseAdmin
        .from('payout_requests')
        .update({ status: 'failed', failure_reason: 'Request timed out' })
        .eq('seller_id', sellerId)
        .in('status', ['pending', 'processing'])
        .lt('created_at', fiveMinsAgo);

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

      let availableBalance = Math.max(0, totalEarnings - completedPayouts - pendingPayouts);

      // Cross-reference with Payluk customer wallet balance if seller has Payluk ID
      try {
        const sellerPaylukId = await getPaylukCustomerId(sellerId);
        if (sellerPaylukId) {
          const wallet = await PaylukService.getCustomerWallet(sellerPaylukId);
          if (typeof wallet.mainBalance === 'number') {
            availableBalance = Math.min(availableBalance, wallet.mainBalance);
          }
        }
      } catch (wErr) {
        console.warn('[PayoutService] getSellerBalance Payluk wallet check warning:', wErr);
      }

      return {
        totalEarnings,
        availableBalance,
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
  static async processPayout(payoutRequestId: string): Promise<{
    success: boolean;
    error?: string;
    reason?: string;
    maximumWithdrawable?: number;
    intentFee?: number;
  }> {
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

      if (fetchError || !payoutRequest) {
        console.error('Error fetching payout request:', fetchError);
        throw fetchError || new Error('Payout request not found');
      }

      if (payoutRequest.status === 'completed') {
        console.log(`[PayoutService] Payout ${payoutRequestId} is already completed. Skipping.`);
        return { success: true };
      }

      // CAS guard: update status from 'pending' to 'processing' atomically
      const { data: updatedRows, error: casError } = await supabaseAdmin
        .from('payout_requests')
        .update({
          status: 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payoutRequestId)
        .eq('status', 'pending')
        .select('id');

      if (casError || !updatedRows || updatedRows.length === 0) {
        console.warn(`[PayoutService] Payout ${payoutRequestId} is already being processed or completed by another worker.`);
        return { success: false, error: 'Payout is already processing or completed' };
      }

      // Get seller account details
      const accountDetails = payoutRequest.seller_account?.account_details as Record<string, string> | null;
      const accountType = payoutRequest.seller_account?.account_type;

      let transferSuccess = false;
      let transferErrorMsg = 'Transfer failed';
      let transferReason = '';
      let transactionReference = '';
      let maximumWithdrawable: number | undefined;
      let intentFee: number | undefined;

      try {
        if (accountType === 'bank_account' || accountType === 'mobile_money' || accountType === 'digital_wallet') {
          const bankCode = accountDetails?.bank_code || accountDetails?.bankCode;
          const accountNumber = accountDetails?.account_number || accountDetails?.accountNumber;
          const accountName = accountDetails?.account_name || accountDetails?.accountName;
          const bankName = accountDetails?.bank_name || accountDetails?.bankName || accountDetails?.bank || 'Bank';

          if (!bankCode || !accountNumber) {
            throw new Error('Missing bank details for payout. Seller must re-add their account.');
          }

          // Fetch current available balance before this payout request was deducted
          const currentBalance = await this.getSellerBalance(payoutRequest.seller_id);
          const yrdlyAvailableBalance = currentBalance.availableBalance + payoutRequest.amount;

          // Check if seller has a Payluk customer ID
          const sellerPaylukId = await getPaylukCustomerId(payoutRequest.seller_id);

          if (sellerPaylukId) {
            console.log(`[PayoutService] Initiating Payluk bank withdrawal for seller ${payoutRequest.seller_id}...`);
            const paylukResult = await PaylukService.withdrawToBank({
              sellerPaylukCustomerId: sellerPaylukId,
              amount: payoutRequest.amount,
              bankCode,
              bankName,
              accountNumber,
              accountName,
              reference: `payout-${payoutRequestId}`,
              yrdlyAvailableBalance,
            });

            transferSuccess = paylukResult.success;
            if (!transferSuccess && paylukResult.error) {
              transferErrorMsg = paylukResult.error;
              transferReason = paylukResult.reason || paylukResult.error;
              maximumWithdrawable = paylukResult.maximumWithdrawable;
              intentFee = paylukResult.intentFee;
            }
            transactionReference = paylukResult.reference || `payout-${payoutRequestId}`;
          } else {
            console.log(`[PayoutService] Seller ${payoutRequest.seller_id} has no Payluk ID, using Paystack transfer...`);
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

          return { success: true };
        } else {
          // Update payout request as failed (releasing Yrdly available balance)
          await supabaseAdmin
            .from('payout_requests')
            .update({
              status: 'failed',
              failure_reason: transferReason || transferErrorMsg,
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', payoutRequestId);

          // Send failure notification
          try {
            await NotificationService.createPayoutFailedNotification(
              payoutRequest.seller_id,
              payoutRequest.amount,
              transferReason || transferErrorMsg,
              payoutRequestId
            );
          } catch (notificationError) {
            console.error('Failed to send payout failure notification:', notificationError);
          }

          return {
            success: false,
            error: transferErrorMsg,
            reason: transferReason,
            maximumWithdrawable,
            intentFee,
          };
        }

      } catch (transferError: any) {
        console.error('Transfer error:', transferError);
        
        const errorMsg = transferError instanceof Error ? transferError.message : 'Unknown error';
        await supabaseAdmin
          .from('payout_requests')
          .update({
            status: 'failed',
            failure_reason: errorMsg,
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', payoutRequestId);

        try {
          await NotificationService.createPayoutFailedNotification(
            payoutRequest.seller_id,
            payoutRequest.amount,
            errorMsg,
            payoutRequestId
          );
        } catch (notificationError) {
          console.error('Failed to send payout failure notification:', notificationError);
        }

        return { success: false, error: errorMsg };
      }

    } catch (error: any) {
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
