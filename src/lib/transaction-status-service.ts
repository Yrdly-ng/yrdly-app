import { supabase } from './supabase';

export class TransactionStatusService {
  private static async transition(transactionId: string, action: 'shipped' | 'delivered'): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const response = await fetch(`/api/transactions/${transactionId}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update transaction');
  }

  static async confirmShipped(transactionId: string, _sellerId: string): Promise<void> {
    await this.transition(transactionId, 'shipped');
  }

  static async confirmDelivered(transactionId: string, _buyerId: string): Promise<void> {
    await this.transition(transactionId, 'delivered');
  }

  static async completeTransaction(transactionId: string): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const response = await fetch(`/api/transactions/${transactionId}/complete`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not complete transaction');
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
