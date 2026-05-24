import { supabase } from './supabase';
import { EscrowStatus } from '@/types/escrow';
import { NotificationService } from './notification-service';
import { PayoutService } from './payout-service';

export class TransactionStatusService {
  /**
   * Confirm payment after Flutterwave verification
   */
  static async confirmPayment(transactionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('escrow_transactions')
        .update({
          status: EscrowStatus.PAID,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);

      if (error) {
        console.error('Error confirming payment:', error);
        throw error;
      }

      // Send notification to seller
      try {
        const { data: transaction } = await supabase
          .from('escrow_transactions')
          .select(`
            buyer_id,
            seller_id,
            amount,
            item:posts(title, text)
          `)
          .eq('id', transactionId)
          .single();

        if (transaction) {
          const { data: buyer } = await supabase
            .from('users')
            .select('name')
            .eq('id', transaction.buyer_id)
            .single();

          const itemTitle = transaction.item?.[0]?.title || transaction.item?.[0]?.text || 'Item';
          const buyerName = buyer?.name || 'Buyer';

          await NotificationService.createPaymentSuccessfulNotification(
            transaction.seller_id,
            buyerName,
            itemTitle,
            transaction.amount,
            transactionId
          );
        }
      } catch (notificationError) {
        console.error('Failed to send payment notification:', notificationError);
        // Don't throw error - payment is still confirmed
      }
    } catch (error) {
      console.error('Failed to confirm payment:', error);
      throw new Error('Failed to confirm payment');
    }
  }

  /**
   * Seller marks item as shipped
   */
  static async confirmShipped(transactionId: string, sellerId: string): Promise<void> {
    try {
      // Verify the seller owns this transaction
      const { data: transaction, error: fetchError } = await supabase
        .from('escrow_transactions')
        .select('seller_id, status')
        .eq('id', transactionId)
        .single();

      if (fetchError) {
        throw new Error('Transaction not found');
      }

      if (transaction.seller_id !== sellerId) {
        throw new Error('Unauthorized: You can only update your own transactions');
      }

      if (transaction.status !== EscrowStatus.PAID) {
        throw new Error('Transaction must be paid before marking as shipped');
      }

      const { error } = await supabase
        .from('escrow_transactions')
        .update({
          status: EscrowStatus.SHIPPED,
          shipped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);

      if (error) {
        console.error('Error confirming shipment:', error);
        throw error;
      }

      // Send notification to buyer
      try {
        const { data: transaction } = await supabase
          .from('escrow_transactions')
          .select(`
            buyer_id,
            seller_id,
            item:posts(title, text)
          `)
          .eq('id', transactionId)
          .single();

        if (transaction) {
          const { data: seller } = await supabase
            .from('users')
            .select('name')
            .eq('id', transaction.seller_id)
            .single();

          const itemTitle = transaction.item?.[0]?.title || transaction.item?.[0]?.text || 'Item';
          const sellerName = seller?.name || 'Seller';

          await NotificationService.createItemShippedNotification(
            transaction.buyer_id,
            sellerName,
            itemTitle,
            transactionId
          );
        }
      } catch (notificationError) {
        console.error('Failed to send shipment notification:', notificationError);
        // Don't throw error - shipment is still confirmed
      }
    } catch (error) {
      console.error('Failed to confirm shipment:', error);
      throw new Error('Failed to confirm shipment');
    }
  }

  /**
   * Buyer confirms delivery
   */
  static async confirmDelivered(transactionId: string, buyerId: string): Promise<void> {
    try {
      // Verify the buyer owns this transaction
      const { data: transaction, error: fetchError } = await supabase
        .from('escrow_transactions')
        .select('buyer_id, status')
        .eq('id', transactionId)
        .single();

      if (fetchError) {
        throw new Error('Transaction not found');
      }

      if (transaction.buyer_id !== buyerId) {
        throw new Error('Unauthorized: You can only update your own transactions');
      }

      if (transaction.status !== EscrowStatus.SHIPPED) {
        throw new Error('Transaction must be shipped before confirming delivery');
      }

      const { error } = await supabase
        .from('escrow_transactions')
        .update({
          status: EscrowStatus.DELIVERED,
          delivered_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);

      if (error) {
        console.error('Error confirming delivery:', error);
        throw error;
      }

      // Send notification to seller
      try {
        const { data: transaction } = await supabase
          .from('escrow_transactions')
          .select(`
            buyer_id,
            seller_id,
            item:posts(title, text)
          `)
          .eq('id', transactionId)
          .single();

        if (transaction) {
          const { data: buyer } = await supabase
            .from('users')
            .select('name')
            .eq('id', transaction.buyer_id)
            .single();

          const itemTitle = transaction.item?.[0]?.title || transaction.item?.[0]?.text || 'Item';
          const buyerName = buyer?.name || 'Buyer';

          await NotificationService.createDeliveryConfirmedNotification(
            transaction.seller_id,
            buyerName,
            itemTitle,
            transactionId
          );
        }
      } catch (notificationError) {
        console.error('Failed to send delivery notification:', notificationError);
        // Don't throw error - delivery is still confirmed
      }
    } catch (error) {
      console.error('Failed to confirm delivery:', error);
      throw new Error('Failed to confirm delivery');
    }
  }

  /**
   * Complete transaction and release funds to seller
   */
  static async completeTransaction(transactionId: string): Promise<void> {
    try {
      const { data: transaction, error: fetchError } = await supabase
        .from('escrow_transactions')
        .select('status, seller_amount, seller_id')
        .eq('id', transactionId)
        .single();

      if (fetchError) {
        throw new Error('Transaction not found');
      }

      if (transaction.status !== EscrowStatus.DELIVERED) {
        throw new Error('Transaction must be delivered before completion');
      }

      // Update transaction status
      const { error: updateError } = await supabase
        .from('escrow_transactions')
        .update({
          status: EscrowStatus.COMPLETED,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);

      if (updateError) {
        console.error('Error completing transaction:', updateError);
        throw updateError;
      }

      // Initiate payout to seller now that buyer has confirmed receipt
      try {
        await PayoutService.initiateAutoPayout(transactionId);
      } catch (payoutError) {
        console.error('Payout initiation failed after buyer confirmation:', payoutError);
        // Don't throw — transaction is still completed even if payout initiation fails
      }
      
      // Send notification to seller about funds release
      try {
        const { data: transaction } = await supabase
          .from('escrow_transactions')
          .select(`
            seller_id,
            seller_amount,
            item:posts(title, text)
          `)
          .eq('id', transactionId)
          .single();

        if (transaction) {
          const itemTitle = transaction.item?.[0]?.title || transaction.item?.[0]?.text || 'Item';

          await NotificationService.createFundsReleasedNotification(
            transaction.seller_id,
            transaction.seller_amount,
            itemTitle,
            transactionId
          );
        }
      } catch (notificationError) {
        console.error('Failed to send funds released notification:', notificationError);
        // Don't throw error - transaction is still completed
      }

      // Initiate automatic payout to seller
      try {
        const { PayoutService } = await import('./payout-service');
        await PayoutService.initiateAutoPayout(transactionId);
      } catch (payoutError) {
        console.error('Failed to initiate payout:', payoutError);
        // Don't throw error here - transaction is still completed
      }

    } catch (error) {
      console.error('Failed to complete transaction:', error);
      throw new Error('Failed to complete transaction');
    }
  }

  /**
   * Cancel transaction (for disputes or other reasons)
   */
  static async cancelTransaction(transactionId: string, reason: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('escrow_transactions')
        .update({
          status: EscrowStatus.CANCELLED,
          dispute_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);

      if (error) {
        console.error('Error cancelling transaction:', error);
        throw error;
      }

      // Mark item as available again
      const { data: transaction } = await supabase
        .from('escrow_transactions')
        .select('item_id')
        .eq('id', transactionId)
        .single();

      if (transaction) {
        const { ItemTrackingService } = await import('./item-tracking-service');
        await ItemTrackingService.markItemAsAvailable(transaction.item_id);
      }

    } catch (error) {
      console.error('Failed to cancel transaction:', error);
      throw new Error('Failed to cancel transaction');
    }
  }

  /**
   * Get transaction details with user information
   * Uses API endpoint to safely bypass RLS and fetch with admin privileges
   */
  static async getTransactionDetails(transactionId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(`/api/transactions/${transactionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`Error fetching transaction details: ${response.status}`, errorData);
        
        if (response.status === 401) {
          throw new Error('You must be logged in to view transactions');
        } else if (response.status === 403) {
          throw new Error('You do not have access to this transaction');
        } else if (response.status === 404) {
          throw new Error('Transaction not found');
        }
        throw new Error(errorData.error || 'Failed to get transaction details');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to get transaction details:', error);
      throw error;
    }
  }

  /**
   * Get user's transactions (as buyer or seller)
   * Uses API endpoint to safely bypass RLS and fetch with admin privileges
   */
  static async getUserTransactions(userId: string, limit: number = 20) {
    try {
      const response = await fetch(`/api/transactions?limit=${limit}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('You must be logged in to view transactions');
        }
        throw new Error('Failed to get user transactions');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to get user transactions:', error);
      throw error;
    }
  }
}
