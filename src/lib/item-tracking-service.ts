import { supabase } from './supabase';
import type { Post } from '@/types';

export interface PurchaseHistory {
  id: string;
  item: Post;
  transactionId: string;
  amount: number;
  status: string;
  purchasedAt: string;
  seller: {
    id: string;
    name: string;
    avatar_url?: string;
  };
}

export interface SoldItemHistory {
  id: string;
  item: Post;
  transactionId: string;
  amount: number;
  status: string;
  soldAt: string;
  buyer: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  sellerAmount: number;
  commission: number;
}

export class ItemTrackingService {
  /**
   * Mark item as sold after successful payment
   */
  static async markItemAsSold(
    itemId: string,
    buyerId: string,
    transactionId: string
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('posts')
        .update({
          is_sold: true,
          sold_to_user_id: buyerId,
          sold_at: new Date().toISOString(),
          transaction_id: transactionId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId);

      if (error) {
        console.error('Error marking item as sold:', error);
        throw error;
      }
    } catch (error) {
      console.error('Failed to mark item as sold:', error);
      throw new Error('Failed to mark item as sold');
    }
  }

  /**
   * Mark item as available again (for cancelled transactions)
   */
  static async markItemAsAvailable(itemId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('posts')
        .update({
          is_sold: false,
          sold_to_user_id: null,
          sold_at: null,
          transaction_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId);

      if (error) {
        console.error('Error marking item as available:', error);
        throw error;
      }
    } catch (error) {
      console.error('Failed to mark item as available:', error);
      throw new Error('Failed to mark item as available');
    }
  }

  /**
   * Get buyer's purchase history
   */
  static async getUserPurchases(userId: string): Promise<PurchaseHistory[]> {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select(`
          id,
          title,
          text,
          description,
          price,
          image_urls,
          timestamp,
          sold_at,
          transaction_id,
          user:users!posts_user_id_fkey(
            id,
            name,
            avatar_url
          )
        `)
        .eq('sold_to_user_id', userId)
        .eq('is_sold', true)
        .order('sold_at', { ascending: false });

      if (error) {
        console.error('Error fetching user purchases:', error);
        throw error;
      }

      // Get transaction details for each purchase
      const purchasesWithTransactions = await Promise.all(
        data.map(async (item) => {
          const { data: transaction } = await supabase
            .from('escrow_transactions')
            .select('amount, status')
            .eq('id', item.transaction_id)
            .single();

          return {
            id: item.id,
            item: item as any,
            transactionId: item.transaction_id,
            amount: transaction?.amount || item.price || 0,
            status: transaction?.status || 'unknown',
            purchasedAt: item.sold_at,
            seller: item.user as any,
          };
        })
      );

      return purchasesWithTransactions;
    } catch (error) {
      console.error('Failed to get user purchases:', error);
      throw new Error('Failed to get purchase history');
    }
  }

  /**
   * Get seller's sold items history
   */
  static async getUserSoldItems(userId: string): Promise<SoldItemHistory[]> {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select(`
          id,
          title,
          text,
          description,
          price,
          image_urls,
          timestamp,
          sold_at,
          transaction_id,
          sold_to_user_id
        `)
        .eq('user_id', userId)
        .eq('is_sold', true)
        .order('sold_at', { ascending: false });

      if (error) {
        console.error('Error fetching user sold items:', error);
        throw error;
      }

      // Get transaction details and buyer info for each sold item
      const soldItemsWithDetails = await Promise.all(
        data.map(async (item) => {
          const { data: transaction } = await supabase
            .from('escrow_transactions')
            .select('amount, commission, seller_amount, status')
            .eq('id', item.transaction_id)
            .single();

          const { data: buyer } = await supabase
            .from('users')
            .select('id, name, avatar_url')
            .eq('id', item.sold_to_user_id)
            .single();

          return {
            id: item.id,
            item: item as any,
            transactionId: item.transaction_id,
            amount: transaction?.amount || item.price || 0,
            status: transaction?.status || 'unknown',
            soldAt: item.sold_at,
            buyer: buyer || { id: item.sold_to_user_id, name: 'Unknown Buyer' },
            sellerAmount: transaction?.seller_amount || 0,
            commission: transaction?.commission || 0,
          };
        })
      );

      return soldItemsWithDetails;
    } catch (error) {
      console.error('Failed to get user sold items:', error);
      throw new Error('Failed to get sold items history');
    }
  }

  /**
   * Check if item is available for purchase
   */
  static async isItemAvailable(itemId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('is_sold')
        .eq('id', itemId)
        .single();

      if (error) {
        console.error('Error checking item availability:', error);
        return false;
      }

      return !data.is_sold;
    } catch (error) {
      console.error('Failed to check item availability:', error);
      return false;
    }
  }

  /**
   * Get item's transaction details if sold
   */
  static async getItemTransaction(itemId: string) {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select(`
          transaction_id,
          sold_to_user_id,
          sold_at,
          is_sold
        `)
        .eq('id', itemId)
        .single();

      if (error || !data.is_sold) {
        return null;
      }

      const { data: transaction } = await supabase
        .from('escrow_transactions')
        .select('*')
        .eq('id', data.transaction_id)
        .single();

      return {
        ...data,
        transaction,
      };
    } catch (error) {
      console.error('Failed to get item transaction:', error);
      return null;
    }
  }
}
