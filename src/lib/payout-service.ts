import { supabaseAdmin } from './supabase-admin';
import { PaylukService } from './payluk-service';
import { getPaylukCustomerId } from './payluk-onboarding';
import { NotificationService } from './server-notification-service';
import { payoutAccountError } from './payout-account';

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
        .select('seller_amount, status, item_type, payment_provider')
        .eq('seller_id', sellerId);

      if (error) {
        console.error('Error fetching seller transactions:', error);
        throw error;
      }

      const completedTransactions = transactions?.filter(t => t.status === 'completed' && t.item_type !== 'ticket' && t.payment_provider === 'payluk') || [];
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

      // Bound withdrawals by both earned funds and provider funds. Ticket funds
      // have a separate payout ledger and must not inflate marketplace balances.
      try {
        const sellerPaylukId = await getPaylukCustomerId(sellerId);
        if (sellerPaylukId) {
          const wallet = await PaylukService.getCustomerWallet(sellerPaylukId);
          if (typeof wallet.mainBalance === 'number' && !isNaN(wallet.mainBalance)) {
            availableBalance = Math.min(availableBalance, Math.max(0, wallet.mainBalance - pendingPayouts));
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
   * Initiate automatic payout after transaction completion.
   * Uses the seller's actual Payluk wallet balance as the payout amount,
   * NOT the DB seller_amount (which may be inflated if Payluk took an escrow fee).
   */
  static async initiateAutoPayout(transactionId: string): Promise<void> {
    try {
      // Get transaction details
      const { data: transaction, error: fetchError } = await supabaseAdmin
        .from('escrow_transactions')
        .select('seller_id, seller_amount, status, payment_provider')
        .eq('id', transactionId)
        .single();

      if (fetchError) {
        console.error('Error fetching transaction:', fetchError);
        throw fetchError;
      }

      if (transaction.status !== 'completed') {
        throw new Error('Transaction must be completed before payout');
      }

      const { data: priorPayout, error: priorError } = await supabaseAdmin
        .from('payout_requests')
        .select('id, status')
        .eq('transaction_id', transactionId)
        .maybeSingle();
      if (priorError) throw priorError;
      if (priorPayout) {
        if (priorPayout.status === 'completed') return;
        throw new Error(`Automatic payout ${priorPayout.id} is ${priorPayout.status}; review or retry that request`);
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
        throw new Error('No active primary seller account for automatic payout');
      }

      if (sellerAccount.verification_status !== 'verified') {
        throw new Error('Seller account is not verified for automatic payout');
      }

      // For Payluk transactions, use the actual Payluk wallet balance as the
      // payout amount. The DB seller_amount = item price, but Payluk takes an
      // escrow release fee, so the wallet has less than seller_amount.
      let payoutAmount = transaction.seller_amount;

      if (transaction.payment_provider === 'payluk') {
        try {
          const sellerPaylukId = await getPaylukCustomerId(transaction.seller_id);
          if (sellerPaylukId) {
            const wallet = await PaylukService.getCustomerWallet(sellerPaylukId);
            const walletBalance = wallet.mainBalance ?? 0;
            if (walletBalance > 0 && walletBalance < payoutAmount) {
              console.log(`[PayoutService] Auto-payout: Adjusting amount from ₦${payoutAmount} to ₦${walletBalance} (Payluk wallet balance after escrow fee)`);
              payoutAmount = walletBalance;
            }
          }
        } catch (walletErr) {
          console.warn('[PayoutService] Auto-payout: Could not check Payluk wallet, using DB seller_amount:', walletErr);
        }
      }

      const payoutRequest = { id:await this.reservePayout(transaction.seller_id,sellerAccount.id,payoutAmount,transactionId) };

      // Process the payout
      const result = await this.processPayout(payoutRequest.id);
      if (!result.success) throw new Error(result.error || 'Automatic payout failed');

    } catch (error) {
      console.error('Failed to initiate auto payout:', error);
      throw new Error('Failed to initiate auto payout');
    }
  }

  static async reservePayout(sellerId:string,accountId:string,amount:number,transactionId?:string): Promise<string> {
    const balance = await this.getSellerBalance(sellerId);
    const { data,error } = await supabaseAdmin.rpc('reserve_seller_payout',{
      p_seller_id:sellerId,p_account_id:accountId,p_amount:amount,
      p_wallet_limit:balance.availableBalance+balance.pendingPayouts,p_transaction_id:transactionId || null,
    });
    if (error || !data) throw new Error('Withdrawal could not be reserved. Refresh your balance and retry.');
    return data;
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
    netAmount?: number;
    totalPaylukDebit?: number;
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

      const accountError = payoutAccountError(payoutRequest.seller_account);
      if (accountError) return { success: false, error: accountError };

      // CAS guard: update status from 'pending' to 'processing' atomically
      const { data: updatedRows, error: casError } = await supabaseAdmin
        .from('payout_requests')
        .update({
          status: 'processing',
          transaction_reference: `payout-${payoutRequestId}`,
          payment_provider:'payluk',
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
      let transferPending = false;
      let transferErrorMsg = 'Transfer failed';
      let transferReason = '';
      let transactionReference = '';
      let maximumWithdrawable: number | undefined;
      let intentFee: number | undefined;
      let actualNetPayoutAmount: number | undefined;
      let actualTotalDebit: number | undefined;

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
          // Since getSellerBalance already uses Payluk wallet as the source of truth,
          // the available balance here reflects what the seller can ACTUALLY withdraw.
          // Add back the pending payout amount since it was already subtracted.
          const yrdlyAvailableBalance = currentBalance.availableBalance + payoutRequest.amount;

          // Check if seller has a Payluk customer ID
          const sellerPaylukId = await getPaylukCustomerId(payoutRequest.seller_id);

          if (sellerPaylukId) {
            // Use the Payluk wallet balance as the withdrawal amount, NOT the payout
            // request amount from the DB. The DB seller_amount may be inflated because
            // it doesn't account for Payluk's escrow release fee.
            const wallet = await PaylukService.getCustomerWallet(sellerPaylukId);
            const paylukWalletBalance = wallet.mainBalance ?? 0;
            // Withdraw the lesser of: the requested amount, or what's actually in the wallet
            const withdrawalAmount = Math.min(payoutRequest.amount, paylukWalletBalance);

            if (withdrawalAmount <= 0) {
              throw new Error(`Seller Payluk wallet balance is ₦${paylukWalletBalance}. Nothing to withdraw.`);
            }

            console.log(`[PayoutService] Initiating Payluk bank withdrawal for seller ${payoutRequest.seller_id}. Requested: ₦${payoutRequest.amount}, Payluk wallet: ₦${paylukWalletBalance}, Withdrawing: ₦${withdrawalAmount}`);
            const paylukResult = await PaylukService.withdrawToBank({
              sellerPaylukCustomerId: sellerPaylukId,
              amount: withdrawalAmount,
              bankCode,
              bankName,
              accountNumber,
              accountName,
              reference: `payout-${payoutRequestId}`,
              yrdlyAvailableBalance: yrdlyAvailableBalance,
              onIntentReady: async reference => {
                const { data: saved, error } = await supabaseAdmin.from('payout_requests')
                  .update({ transaction_reference: reference }).eq('id', payoutRequestId).eq('status', 'processing').select('id').maybeSingle();
                if (error || !saved) throw new Error('Could not persist withdrawal reference; transfer was not executed.');
              },
            });

            transferSuccess = paylukResult.outcome === 'success';
            transferPending = paylukResult.outcome === 'pending';
            actualNetPayoutAmount = paylukResult.intentAmount;
            intentFee = paylukResult.intentFee;
            actualTotalDebit = paylukResult.totalPaylukDebit;
            if (!transferSuccess && paylukResult.error) {
              transferErrorMsg = paylukResult.error;
              transferReason = paylukResult.reason || paylukResult.error;
              maximumWithdrawable = paylukResult.maximumWithdrawable;
            }
            transactionReference = paylukResult.reference || `payout-${payoutRequestId}`;
          } else {
            throw new Error('Payment identity unavailable; no alternate provider was attempted.');
          }
        }

        if (transferSuccess) {
          // Update payout request as completed with final net amount
          const finalPayoutAmount = (actualTotalDebit && actualTotalDebit > 0)
            ? actualTotalDebit
            : payoutRequest.amount;

          const { data: finalized, error: finalizeError } = await supabaseAdmin
            .from('payout_requests')
            .update({
              amount: finalPayoutAmount,
              status: 'completed',
              transaction_reference: transactionReference,
              processed_at: new Date().toISOString(),
            })
            .eq('id', payoutRequestId)
            .eq('status', 'processing')
            .select('id');
          if (finalizeError || !finalized?.length) {
            console.error('[PayoutService] Transfer accepted but payout record needs manual reconciliation', {
              payoutRequestId, transactionReference, finalizeError,
            });
            return { success: false, error: 'Transfer accepted; payout status needs reconciliation. Do not retry this payout.' };
          }

          // Send success notification
          try {
            await NotificationService.createPayoutProcessedNotification(
              payoutRequest.seller_id,
              actualNetPayoutAmount || finalPayoutAmount,
              payoutRequestId
            );
          } catch (notificationError) {
            console.error('Failed to send payout success notification:', notificationError);
          }

          return {
            success: true,
            netAmount: actualNetPayoutAmount,
            intentFee,
            totalPaylukDebit: actualTotalDebit,
          };
        } else {
          // Update payout request as failed (releasing Yrdly available balance)
          await supabaseAdmin
            .from('payout_requests')
            .update({
              status: transferPending ? 'processing' : 'failed',
              transaction_reference: transactionReference,
              failure_reason: transferReason || transferErrorMsg,
              processed_at: new Date().toISOString(),
            })
            .eq('id', payoutRequestId).eq('status','processing');

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
            status: 'processing',
            failure_reason: `Uncertain transfer; reconcile before retry: ${errorMsg}`,
            processed_at: new Date().toISOString(),
          })
          .eq('id', payoutRequestId).eq('status','processing');

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

      const payoutRequest = { id:await this.reservePayout(sellerId,sellerAccount.id,amount) };

      // Process the payout
      const result = await this.processPayout(payoutRequest.id);
      if (!result.success) throw new Error(result.error || 'Manual payout failed');

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

      return (data || []).map(row => ({
        id: row.id, sellerId: row.seller_id, accountId: row.account_id,
        amount: Number(row.amount), status: row.status, requestedAt: new Date(row.requested_at),
        processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
        failureReason: row.failure_reason || undefined, transactionReference: row.transaction_reference || undefined,
      }));
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
