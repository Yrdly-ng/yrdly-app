import { isTransientPaylukFailure, paylukRetryAfterSeconds, payoutRateLimitMessage } from './payluk-rate-limit';
import { supabaseAdmin } from '../supabase/supabase-admin';
import { PaylukService } from './payluk-service';
import { getPaylukCustomerId } from './payluk-onboarding';
import { NotificationService } from '../notifications/server-notification-service';
import { payoutAccountError } from './payout-account';
import { randomUUID } from 'node:crypto';
import { toPayoutReceipt, payoutAccountSnapshot, type PayoutReceipt } from './payout-receipt';

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
  static async getSellerLedgerBalance(sellerId: string): Promise<SellerBalance> {
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

      return {
        totalEarnings,
        availableBalance: Math.max(0, totalEarnings - completedPayouts - pendingPayouts),
        pendingPayouts,
        completedPayouts,
      };
    } catch (error) {
      console.error('Failed to get seller balance:', error);
      throw new Error('Failed to get seller balance');
    }
  }

  static async getSellerBalance(sellerId: string): Promise<SellerBalance> {
    const balance = await this.getSellerLedgerBalance(sellerId);
    // Ticket proceeds have a separate ledger. Display availability is bounded
    // by both earned funds and provider funds; execution always rechecks wallet.
    try {
      const customerId = await getPaylukCustomerId(sellerId);
      const wallet = await PaylukService.getCustomerWallet(customerId);
      balance.availableBalance = Math.min(balance.availableBalance, Math.max(0, wallet.mainBalance - balance.pendingPayouts));
    } catch (error) {
      console.warn('[PayoutService] Seller balance provider check unavailable:', error);
    }
    return balance;
  }

  /** Bank withdrawals require an explicit seller request. */
  static async initiateAutoPayout(_transactionId: string): Promise<void> {
    throw new Error('Automatic payouts are disabled. Withdraw funds from your payout balance.');
  }

  static async reservePayout(sellerId:string,accountId:string,amount:number,transactionId?:string): Promise<string> {
    const balance = await this.getSellerLedgerBalance(sellerId);
    if (amount > balance.availableBalance) throw new Error('INSUFFICIENT_BALANCE');
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
  static async processPayout(payoutRequestId: string, recoveryToken?: string): Promise<{
    success: boolean;
    error?: string;
    reason?: string;
    maximumWithdrawable?: number;
    intentFee?: number;
    netAmount?: number;
    totalPaylukDebit?: number;
    retryAfterSeconds?: number;
    retryable?: boolean;
    transientFailure?: boolean;
  }> {
    // Old recovery workers must never submit a bank withdrawal.
    if (recoveryToken) return { success: false, error: 'Automatic payouts are disabled.' };
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

      // A retry gets a fresh intent namespace. Never reuse a failed provider
      // intent, and persist the attempt before contacting the provider.
      const attemptReference = `payout-${payoutRequestId}-${randomUUID()}`;

      // CAS guard: update status from 'pending' to 'processing' atomically
      let claimed = false;
      if (recoveryToken) {
        const { data, error } = await supabaseAdmin.rpc('start_automatic_payout_attempt', {
          p_payout_id: payoutRequestId, p_token: recoveryToken, p_reference: attemptReference,
        });
        claimed = !error && data === true;

      } else {
      const { data: updatedRows, error: casError } = await supabaseAdmin
        .from('payout_requests')
        .update({
          status: 'processing',
          transaction_reference: attemptReference,
          payment_provider:'payluk',
          execution_stage: 'preparing',
          receipt_snapshot: payoutAccountSnapshot(payoutRequest.seller_account?.account_details),
        })
        .eq('id', payoutRequestId)
        .eq('status', 'pending')
        .select('id');

        claimed = !casError && !!updatedRows?.length;
      }
      if (!claimed) return { success: false, error: 'Payout is already processing or completed' };

      if (recoveryToken) {
        await supabaseAdmin.from('payout_requests').update({
          receipt_snapshot: payoutAccountSnapshot(payoutRequest.seller_account?.account_details),
        }).eq('id', payoutRequestId).eq('transaction_reference', attemptReference).eq('status', 'processing');
      }

      // Get seller account details
      const accountDetails = payoutRequest.seller_account?.account_details as Record<string, string> | null;
      const accountType = payoutRequest.seller_account?.account_type;

      let transferSuccess = false;
      let transferPending = false;
      let transferErrorMsg = 'Transfer failed';
      let transferReason = '';
      let transactionReference = attemptReference;
      let persistedReference = attemptReference;
      let submissionMayHaveStarted = false;
      let retryAfterSeconds: number | undefined;
      let transientFailure = false;
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

          // Recheck the ledger without repeating customer/wallet API calls.
          // Exclude only this payout's reservation, retaining all other claims.
          const currentBalance = await this.getSellerLedgerBalance(payoutRequest.seller_id);
          const yrdlyAvailableBalance = Math.max(0, currentBalance.totalEarnings - currentBalance.completedPayouts
            - Math.max(0, currentBalance.pendingPayouts - Number(payoutRequest.amount)));

          // Check if seller has a Payluk customer ID
          const sellerPaylukId = await getPaylukCustomerId(payoutRequest.seller_id);

          if (sellerPaylukId) {
            // withdrawToBank performs the final authoritative wallet check and
            // applies the quoted fee within this exact reserved debit budget.
            const paylukResult = await PaylukService.withdrawToBank({
              sellerPaylukCustomerId: sellerPaylukId,
              amount: Number(payoutRequest.amount),
              bankCode,
              bankName,
              accountNumber,
              accountName,
              reference: attemptReference,
              yrdlyAvailableBalance: yrdlyAvailableBalance,
              onIntentReady: async (reference, quote) => {
                if (recoveryToken) {
                  const { data, error } = await supabaseAdmin.rpc('submit_automatic_payout_attempt', {
                    p_payout_id: payoutRequestId, p_token: recoveryToken,
                    p_expected_reference: attemptReference, p_reference: reference,
                    p_debit: quote.amount + quote.fee, p_net: quote.amount,
                  });
                  if (error || !data) throw new Error('Automatic payout lease expired; transfer was not executed');
                  submissionMayHaveStarted = true;
                  persistedReference = reference;
                  return;
                }
                submissionMayHaveStarted = true;
                const { data: saved, error } = await supabaseAdmin.from('payout_requests')
                  .update({ transaction_reference: reference, execution_stage: 'submitted' }).eq('id', payoutRequestId)
                  .eq('status', 'processing').eq('execution_stage', 'preparing').eq('transaction_reference', attemptReference)
                  .select('id').maybeSingle();
                if (error || !saved) throw new Error('Could not persist withdrawal reference; transfer was not executed.');
                persistedReference = reference;
              },
            });

            transferSuccess = paylukResult.outcome === 'success';
            transferPending = paylukResult.outcome === 'pending';
            retryAfterSeconds = paylukResult.retryAfterSeconds;
            transientFailure = paylukResult.transientFailure === true;
            actualNetPayoutAmount = paylukResult.intentAmount;
            intentFee = paylukResult.intentFee;
            actualTotalDebit = paylukResult.totalPaylukDebit;
            if (!transferSuccess && paylukResult.error) {
              transferErrorMsg = paylukResult.error;
              transferReason = paylukResult.reason || paylukResult.error;
              maximumWithdrawable = paylukResult.maximumWithdrawable;
            }
            transactionReference = paylukResult.reference || attemptReference;
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
              receipt_snapshot: { ...payoutAccountSnapshot(accountDetails), fee: intentFee ?? null, netAmount: actualNetPayoutAmount ?? null },
              status: 'completed',
              transaction_reference: transactionReference,
              processed_at: new Date().toISOString(),
            })
            .eq('id', payoutRequestId)
            .eq('status', 'processing').eq('transaction_reference', persistedReference)
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
          const { data: failedRows, error: failedError } = await supabaseAdmin
            .from('payout_requests')
            .update({
              status: transferPending ? 'processing' : 'failed',
              receipt_snapshot: { ...payoutAccountSnapshot(accountDetails), fee: intentFee ?? null, netAmount: actualNetPayoutAmount ?? null },
              transaction_reference: transactionReference,
              failure_reason: transferReason || transferErrorMsg,
              processed_at: new Date().toISOString(),
            })
            .eq('id', payoutRequestId).eq('status','processing').eq('transaction_reference', persistedReference)
            .eq('execution_stage', submissionMayHaveStarted ? 'submitted' : 'preparing').select('id');
          if (failedError || !failedRows?.length) return { success: false, retryable: false, error: 'Payout status needs reconciliation. Do not retry yet.' };

          // Pending outcomes must not be announced as failed.
          if (!transferPending && !recoveryToken) try {
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
            retryAfterSeconds,
            retryable: !transferPending,
            transientFailure,
          };
        }

      } catch (transferError: any) {
        console.error('Transfer error:', transferError);
        
        const delay = paylukRetryAfterSeconds(transferError);
        const errorMsg = !submissionMayHaveStarted && delay
          ? payoutRateLimitMessage(delay)
          : transferError instanceof Error ? transferError.message : 'Unknown error';
        // Only the worker that still owns this preparation can release its funds.
        // Once intent persistence is attempted, retain the reservation on uncertainty.
        const { data: changed, error: saveError } = await supabaseAdmin
          .from('payout_requests')
          .update({
            status: submissionMayHaveStarted ? 'processing' : 'failed',
            failure_reason: submissionMayHaveStarted ? `Uncertain transfer; reconcile before retry: ${errorMsg}` : errorMsg,
            processed_at: new Date().toISOString(),
          })
          .eq('id', payoutRequestId).eq('status', 'processing')
          .eq('transaction_reference', persistedReference)
          .eq('execution_stage', submissionMayHaveStarted ? 'submitted' : 'preparing').select('id');
        if (saveError || !changed?.length) return { success: false, retryable: false, error: 'Payout status needs reconciliation. Do not retry yet.' };

        if (!submissionMayHaveStarted && !recoveryToken) try {
          await NotificationService.createPayoutFailedNotification(
            payoutRequest.seller_id, payoutRequest.amount, errorMsg, payoutRequestId
          );
        } catch (notificationError) {
          console.error('Failed to send payout failure notification:', notificationError);
        }
        return {
          success: false,
          error: submissionMayHaveStarted ? 'Transfer outcome is uncertain; reconcile this payout before retrying.' : errorMsg,
          retryable: !submissionMayHaveStarted,
          retryAfterSeconds: submissionMayHaveStarted ? undefined : delay,
          transientFailure: !submissionMayHaveStarted && isTransientPaylukFailure(transferError),
        };
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
  static async getSellerPayoutHistory(sellerId: string): Promise<PayoutReceipt[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('payout_requests')
        .select('*, seller_account:seller_accounts(account_details,created_at,updated_at,account_updated_at)')
        .eq('seller_id', sellerId)
        .order('requested_at', { ascending: false });

      if (error) {
        console.error('Error fetching payout history:', error);
        throw error;
      }

      return (data || []).map(toPayoutReceipt);
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
