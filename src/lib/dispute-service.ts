import { supabase } from './supabase';
import { NotificationService } from './notification-service';

export interface DisputeData {
  id: string;
  transactionId: string;
  openedBy: string;
  disputeReason: string;
  buyerEvidence: any;
  sellerEvidence: any;
  adminNotes?: string;
  resolution?: string;
  status: 'open' | 'under_review' | 'resolved' | 'closed';
  resolvedBy?: string;
  refundAmount: number;
  sellerAmount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  transaction?: {
    id: string;
    amount: number;
    buyer_id: string;
    seller_id: string;
    item: {
      id: string;
      title?: string;
      text?: string;
      image_urls?: string[];
    };
    buyer: {
      id: string;
      name: string;
      avatar_url?: string;
      email: string;
    };
    seller: {
      id: string;
      name: string;
      avatar_url?: string;
      email: string;
    };
  };
}

export interface DisputeEvidence {
  photos?: string[];
  description: string;
  chatScreenshots?: string[];
  additionalNotes?: string;
}

export class DisputeService {
  /**
   * Open a new dispute
   */
  static async openDispute(
    transactionId: string,
    userId: string,
    reason: string,
    evidence: DisputeEvidence
  ): Promise<string> {
    try {
      // Verify user has access to this transaction
      const { data: transaction, error: fetchError } = await supabase
        .from('escrow_transactions')
        .select('buyer_id, seller_id, status')
        .eq('id', transactionId)
        .single();

      if (fetchError) {
        throw new Error('Transaction not found');
      }

      if (transaction.buyer_id !== userId && transaction.seller_id !== userId) {
        throw new Error('Unauthorized: You can only dispute your own transactions');
      }

      if (transaction.status === 'completed' || transaction.status === 'cancelled') {
        throw new Error('Cannot dispute completed or cancelled transactions');
      }

      // Check if dispute already exists
      const { data: existingDispute } = await supabase
        .from('disputes')
        .select('id')
        .eq('transaction_id', transactionId)
        .single();

      if (existingDispute) {
        throw new Error('A dispute already exists for this transaction');
      }

      // Create dispute
      const disputeData = {
        transaction_id: transactionId,
        opened_by: userId,
        dispute_reason: reason,
        buyer_evidence: transaction.buyer_id === userId ? evidence : {},
        seller_evidence: transaction.seller_id === userId ? evidence : {},
        status: 'open',
        refund_amount: 0,
        seller_amount: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('disputes')
        .insert(disputeData)
        .select('id')
        .single();

      if (error) {
        console.error('Error creating dispute:', error);
        throw error;
      }

      // Update escrow transaction status to disputed
      await supabase
        .from('escrow_transactions')
        .update({
          status: 'disputed',
          dispute_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);

      // Send notifications to both parties
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
          const { data: openedByUser } = await supabase
            .from('users')
            .select('name')
            .eq('id', userId)
            .single();

          const itemTitle = transaction.item?.[0]?.title || transaction.item?.[0]?.text || 'Item';
          const openedByName = openedByUser?.name || 'User';

          // Notify the other party
          const otherUserId = userId === transaction.buyer_id 
            ? transaction.seller_id 
            : transaction.buyer_id;

          await NotificationService.createDisputeOpenedNotification(
            otherUserId,
            openedByName,
            itemTitle,
            data.id,
            transactionId
          );
        }
      } catch (notificationError) {
        console.error('Failed to send dispute notification:', notificationError);
        // Don't throw error - dispute is still created
      }

      // Sync to Zoho in the background (fire and forget so it doesn't block UI)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        fetch('/api/disputes/sync-zoho', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
          },
          body: JSON.stringify({ disputeId: data.id })
        }).catch(err => console.error('Background Zoho sync failed:', err));
      } catch (e) {
        // Ignore auth fetch errors for Zoho sync
      }

      return data.id;
    } catch (error) {
      console.error('Failed to open dispute:', error);
      throw new Error('Failed to open dispute');
    }
  }

  /**
   * Submit additional evidence to an existing dispute
   */
  static async submitEvidence(
    disputeId: string,
    userId: string,
    evidence: DisputeEvidence
  ): Promise<void> {
    try {
      // Get dispute details
      const { data: dispute, error: fetchError } = await supabase
        .from('disputes')
        .select('transaction_id, opened_by')
        .eq('id', disputeId)
        .single();

      if (fetchError) {
        throw new Error('Dispute not found');
      }

      // Get transaction to determine user role
      const { data: transaction } = await supabase
        .from('escrow_transactions')
        .select('buyer_id, seller_id')
        .eq('id', dispute.transaction_id)
        .single();

      if (!transaction) {
        throw new Error('Transaction not found');
      }

      // Verify user has access to this dispute
      if (transaction.buyer_id !== userId && transaction.seller_id !== userId) {
        throw new Error('Unauthorized: You can only submit evidence for your own disputes');
      }

      // Update evidence based on user role
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };

      if (transaction.buyer_id === userId) {
        updateData.buyer_evidence = evidence;
      } else if (transaction.seller_id === userId) {
        updateData.seller_evidence = evidence;
      }

      const { error } = await supabase
        .from('disputes')
        .update(updateData)
        .eq('id', disputeId);

      if (error) {
        console.error('Error submitting evidence:', error);
        throw error;
      }
    } catch (error) {
      console.error('Failed to submit evidence:', error);
      throw new Error('Failed to submit evidence');
    }
  }

  /**
   * Resolve a dispute (admin only)
   */
  static async resolveDispute(
    disputeId: string,
    adminId: string, // Kept for backwards compatibility with function signature, but auth is handled by cookies now
    resolution: string,
    refundAmount: number,
    sellerAmount: number
  ): Promise<void> {
    try {
      // Get the current session to pass the access token
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(`/api/admin/disputes/${disputeId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          resolution,
          refundAmount,
          sellerAmount
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to resolve dispute securely');
      }
    } catch (error) {
      console.error('Failed to resolve dispute:', error);
      throw error;
    }
  }

  /**
   * Get disputes by user
   */
  static async getDisputesByUser(userId: string): Promise<DisputeData[]> {
    try {
      const { data, error } = await supabase
        .from('disputes')
        .select(`
          *,
          transaction:escrow_transactions(
            id,
            amount,
            buyer_id,
            seller_id,
            status,
            item:posts(
              id,
              title,
              text,
              image_urls
            )
          )
        `)
        .or(`opened_by.eq.${userId},transaction.buyer_id.eq.${userId},transaction.seller_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching user disputes:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Failed to get user disputes:', error);
      throw new Error('Failed to get user disputes');
    }
  }

  /**
   * Get disputes by status (admin)
   */
  static async getDisputesByStatus(status: string): Promise<DisputeData[]> {
    try {
      const { data, error } = await supabase
        .from('disputes')
        .select(`
          *,
          transaction:escrow_transactions(
            id,
            amount,
            buyer_id,
            seller_id,
            status,
            item:posts(
              id,
              title,
              text,
              image_urls
            ),
            buyer:users(
              id,
              name,
              avatar_url
            ),
            seller:users(
              id,
              name,
              avatar_url
            )
          )
        `)
        .eq('status', status)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching disputes by status:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Failed to get disputes by status:', error);
      throw new Error('Failed to get disputes by status');
    }
  }

  /**
   * Get dispute details
   */
  static async getDisputeDetails(disputeId: string): Promise<DisputeData | null> {
    try {
      const { data, error } = await supabase
        .from('disputes')
        .select(`
          *,
          transaction:escrow_transactions(
            id,
            amount,
            buyer_id,
            seller_id,
            status,
            item:posts(
              id,
              title,
              text,
              image_urls
            ),
            buyer:users(
              id,
              name,
              avatar_url,
              email
            ),
            seller:users(
              id,
              name,
              avatar_url,
              email
            )
          )
        `)
        .eq('id', disputeId)
        .single();

      if (error) {
        console.error('Error fetching dispute details:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Failed to get dispute details:', error);
      return null;
    }
  }
  static async addAdminNotes(disputeId: string, notes: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('disputes')
        .update({
          admin_notes: notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', disputeId);

      if (error) {
        console.error('Error adding admin notes:', error);
        throw error;
      }
    } catch (error) {
      console.error('Failed to add admin notes:', error);
      throw new Error('Failed to add admin notes');
    }
  }
}
