import { supabase } from './supabase';

export interface DisputeData {
  id: string;
  transactionId: string;
  transaction_id?: string;
  openedBy: string;
  opened_by?: string;
  disputeReason: string;
  dispute_reason?: string;
  buyerEvidence: any;
  buyer_evidence?: any;
  sellerEvidence: any;
  seller_evidence?: any;
  adminNotes?: string;
  admin_notes?: string;
  resolution?: string;
  status: 'open' | 'under_review' | 'resolved' | 'closed';
  resolvedBy?: string;
  resolved_by?: string;
  refundAmount: number;
  refund_amount?: number;
  sellerAmount: number;
  seller_amount?: number;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
  resolvedAt?: string;
  resolved_at?: string;
  resolutionOperation?: { status: string; errorMessage?: string | null; createdAt?: string; updatedAt?: string; providerReference?: string | null; resolution?: string; refundAmount?: number; sellerAmount?: number } | null;
  providerSubmissionStatus?: 'not_required' | 'processing' | 'submitted' | 'needs_reconciliation';
  providerSubmissionError?: string | null;
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
  private static async authenticatedFetch(path: string, init: RequestInit = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...init.headers,
      },
    });
  }

  /**
   * Open a new dispute
   */
  static async openDispute(
    transactionId: string,
    userId: string,
    reason: string,
    evidence: DisputeEvidence
  ): Promise<{ id: string; providerSubmissionStatus?: string }> {
    void userId;
    const response = await this.authenticatedFetch('/api/disputes', {
      method: 'POST',
      body: JSON.stringify({ transactionId, reason, evidence }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not open dispute.');
    return result;
  }

  /**
   * Submit additional evidence to an existing dispute
   */
  static async submitEvidence(
    disputeId: string,
    userId: string,
    evidence: DisputeEvidence
  ): Promise<void> {
    void userId;
    const response = await this.authenticatedFetch(`/api/disputes/${disputeId}/evidence`, {
      method: 'POST',
      body: JSON.stringify(evidence),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Failed to submit evidence.');
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
  ): Promise<{ success: boolean; resolutionStatus?: string; error?: string }> {
    void adminId;
    try {
      const response = await this.authenticatedFetch(`/api/admin/disputes/${disputeId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          resolution,
          refundAmount,
          sellerAmount
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 202) throw new Error(result.error || 'Failed to resolve dispute securely');
      return { success: Boolean(result.success), resolutionStatus: result.resolutionStatus, error: result.error };
    } catch (error) {
      console.error('Failed to resolve dispute:', error);
      throw error;
    }
  }

  /**
   * Get disputes by user
   */
  static async getDisputesByUser(userId: string): Promise<DisputeData[]> {
    void userId;
    const response = await this.authenticatedFetch('/api/disputes');
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Failed to load disputes.');
    return result.data || [];
  }

  /**
   * Get disputes by status (admin)
   */
  static async getDisputesByStatus(status: string, page: number = 1, limit: number = 20): Promise<{ data: DisputeData[], count: number }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams({
        status: status || 'all',
        page: page.toString(),
        limit: limit.toString(),
      });

      const response = await fetch(`/api/admin/disputes?${params.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch admin disputes');
      }

      const result = await response.json();
      return { data: result.data || [], count: result.count || 0 };
    } catch (error) {
      console.error('Failed to get disputes by status:', error);
      throw error;
    }
  }

  /**
   * Get dispute details (by dispute ID or transaction ID)
   */
  static async getDisputeDetails(disputeId: string): Promise<DisputeData | null> {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`/api/disputes/${disputeId}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
      }
    });

    if (response.status === 404) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Failed to load dispute details.');
    return result;
  }
  static async addAdminNotes(disputeId: string, notes: string): Promise<void> {
    const response = await this.authenticatedFetch(`/api/admin/disputes/${disputeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Failed to save admin notes.');
  }

  static async reconcileResolution(disputeId: string, outcome: 'applied' | 'not_applied', providerReference?: string): Promise<void> {
    const response = await this.authenticatedFetch(`/api/admin/disputes/${disputeId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ outcome, providerReference }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not reconcile payment.');
  }

  static async confirmPaylukSubmission(disputeId: string): Promise<void> {
    const response = await this.authenticatedFetch(`/api/admin/disputes/${disputeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ providerSubmissionStatus: 'submitted' }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not confirm Payluk submission.');
  }

  static async retryPaylukSubmission(disputeId: string): Promise<void> {
    const response = await this.authenticatedFetch(`/api/admin/disputes/${disputeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ providerSubmissionStatus: 'retry' }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not retry Payluk submission.');
  }
}
