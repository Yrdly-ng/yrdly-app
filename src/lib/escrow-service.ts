import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
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