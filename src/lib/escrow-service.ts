import { supabase } from '@/lib/supabase';
import { 
  EscrowTransaction, 
  EscrowStatus, 
  PaymentMethod, 
  DeliveryOption, 
  DeliveryDetails,
  EscrowStats 
} from '@/types/escrow';
import { MARKETPLACE_CONSTANTS } from '@/lib/constants';

const COMMISSION_RATE = MARKETPLACE_CONSTANTS.COMMISSION_RATE; // 3% platform commission

export class EscrowService {
  // Create a new escrow transaction
  static async createTransaction(
    itemId: string,
    buyerId: string,
    sellerId: string,
    amount: number,
    paymentMethod: PaymentMethod,
    deliveryDetails: DeliveryDetails
  ): Promise<string> {
    const commission = amount * COMMISSION_RATE;
    const totalAmount = amount; // Buyer pays the full item price
    const sellerAmount = amount - commission; // Seller receives amount minus commission

    const transactionData = {
      item_id: itemId,
      buyer_id: buyerId,
      seller_id: sellerId,
      amount,
      commission,
      total_amount: totalAmount,
      seller_amount: sellerAmount,
      status: EscrowStatus.PENDING,
      payment_method: paymentMethod,
      delivery_details: deliveryDetails,
      paid_at: null,
      shipped_at: null,
      delivered_at: null,
      completed_at: null,
      dispute_reason: null,
      dispute_resolved_at: null,
    };

    const { data, error } = await supabase
      .from('escrow_transactions')
      .insert(transactionData)
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  // Update transaction status
  static async updateStatus(
    transactionId: string,
    status: EscrowStatus,
    additionalData?: Partial<EscrowTransaction>
  ): Promise<void> {
    const updateData: any = {
      status,
    };

    // Add timestamp based on status
    switch (status) {
      case EscrowStatus.PAID:
        updateData.paid_at = new Date().toISOString();
        break;
      case EscrowStatus.SHIPPED:
        updateData.shipped_at = new Date().toISOString();
        break;
      case EscrowStatus.DELIVERED:
        updateData.delivered_at = new Date().toISOString();
        break;
      case EscrowStatus.COMPLETED:
        updateData.completed_at = new Date().toISOString();
        break;
    }

    // Add any additional data
    if (additionalData) {
      Object.assign(updateData, additionalData);
    }

    const { error } = await supabase
      .from('escrow_transactions')
      .update(updateData)
      .eq('id', transactionId);

    if (error) throw error;
  }

  // Get transaction by ID
  static async getTransaction(transactionId: string): Promise<EscrowTransaction | null> {
    const { data, error } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (error) throw error;
    return data as EscrowTransaction;
  }

  // Get user's transactions
  static async getUserTransactions(userId: string): Promise<EscrowTransaction[]> {
    const { data, error } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('buyer_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as EscrowTransaction[];
  }

  // Get seller's transactions
  static async getSellerTransactions(sellerId: string): Promise<EscrowTransaction[]> {
    const { data, error } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as EscrowTransaction[];
  }

  // Update delivery details
  static async updateDeliveryDetails(
    transactionId: string,
    deliveryDetails: DeliveryDetails
  ): Promise<void> {
    const { error } = await supabase
      .from('escrow_transactions')
      .update({
        delivery_details: deliveryDetails,
      })
      .eq('id', transactionId);

    if (error) throw error;
  }

  // Dispute a transaction
  static async disputeTransaction(
    transactionId: string,
    reason: string
  ): Promise<void> {
    const { error } = await supabase
      .from('escrow_transactions')
      .update({
        status: EscrowStatus.DISPUTED,
        dispute_reason: reason,
      })
      .eq('id', transactionId);

    if (error) throw error;
  }

  // Resolve a dispute
  static async resolveDispute(
    transactionId: string,
    resolution: string
  ): Promise<void> {
    const { error } = await supabase
      .from('escrow_transactions')
      .update({
        dispute_reason: resolution,
        dispute_resolved_at: new Date().toISOString(),
      })
      .eq('id', transactionId);

    if (error) throw error;
  }

  // Get escrow statistics
  static async getStats(): Promise<EscrowStats> {
    const { data, error } = await supabase
      .from('escrow_transactions')
      .select('*');

    if (error) throw error;

    let totalTransactions = 0;
    let totalVolume = 0;
    let totalCommission = 0;
    let pendingTransactions = 0;
    let completedTransactions = 0;
    let disputedTransactions = 0;

    data.forEach((transaction) => {
      totalTransactions++;
      totalVolume += transaction.amount;
      totalCommission += transaction.commission;

      switch (transaction.status) {
        case EscrowStatus.PENDING:
          pendingTransactions++;
          break;
        case EscrowStatus.COMPLETED:
          completedTransactions++;
          break;
        case EscrowStatus.DISPUTED:
          disputedTransactions++;
          break;
      }
    });

    return {
      totalTransactions,
      totalVolume,
      totalCommission,
      pendingTransactions,
      completedTransactions,
      disputedTransactions
    };
  }
}