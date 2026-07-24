import { supabase } from './supabase';
import * as Sentry from '@/lib/sentry';
import { NotificationService } from './notification-service';
import { EscrowStatus } from '@/types/escrow';

export class ReviewService {
  /**
   * Check if a user can review a business based on a transaction
   */
  static async canUserReviewBusiness(
    userId: string,
    businessId: string,
    transactionId: string
  ): Promise<{ canReview: boolean; reason?: string }> {
    try {
      // Check if transaction exists and is completed
      const { data: transaction, error: transactionError } = await supabase
        .from('escrow_transactions')
        .select('id, buyer_id, seller_id, status, item:posts(id)')
        .eq('id', transactionId)
        .single();

      if (transactionError || !transaction) {
        return { canReview: false, reason: 'Transaction not found' };
      }

      // Check if user is the buyer
      if (transaction.buyer_id !== userId) {
        return { canReview: false, reason: 'Only buyers can review' };
      }

      // Check if transaction is completed
      if (transaction.status !== EscrowStatus.COMPLETED) {
        return { canReview: false, reason: 'Transaction must be completed' };
      }

      // Check if user already reviewed this transaction
      const { data: existingReview } = await supabase
        .from('business_reviews')
        .select('id')
        .eq('transaction_id', transactionId)
        .eq('user_id', userId)
        .single();

      if (existingReview) {
        return { canReview: false, reason: 'Already reviewed' };
      }

      return { canReview: true };
    } catch (error) {
      Sentry.captureException(error);
      console.error('Error checking review eligibility:', error);
      return { canReview: false, reason: 'Error checking eligibility' };
    }
  }

  /**
   * Submit a review for a business
   */
  static async submitReview(
    businessId: string,
    userId: string,
    transactionId: string,
    rating: number,
    comment?: string
  ): Promise<string> {
    return Sentry.startSpan(
      {
        op: 'review.submit',
        name: 'Submit Business Review',
      },
      async () => {
        try {
          // Validate rating
          if (rating < 1 || rating > 5) {
            throw new Error('Rating must be between 1 and 5');
          }

          // Check eligibility
          const { canReview, reason } = await this.canUserReviewBusiness(
            userId,
            businessId,
            transactionId
          );

          if (!canReview) {
            throw new Error(reason || 'Cannot review this business');
          }

          // Insert review
          const { data, error } = await supabase
            .from('business_reviews')
            .insert({
              business_id: businessId,
              user_id: userId,
              transaction_id: transactionId,
              verified_purchase: true,
              rating,
              comment: comment || '',
            })
            .select('id')
            .single();

          if (error) throw error;

          // Update business rating and count
          await this.updateBusinessRating(businessId);

          // Send notification to business owner
          try {
            const { data: business } = await supabase
              .from('businesses')
              .select('owner_id')
              .eq('id', businessId)
              .single();

            const { data: reviewer } = await supabase
              .from('users')
              .select('name')
              .eq('id', userId)
              .single();

            if (business && reviewer) {
              await NotificationService.createBusinessReviewReceivedNotification(
                business.owner_id,
                reviewer.name || 'A customer',
                rating,
                businessId,
                data.id
              );
            }
          } catch (notificationError) {
            console.error('Failed to send review notification:', notificationError);
            // Don't throw error - review is still created
          }

          Sentry.logger.info('Review submitted successfully', {
            reviewId: data.id,
            businessId,
            rating,
          });

          return data.id;
        } catch (error) {
          Sentry.captureException(error);
          console.error('Error submitting review:', error);
          throw new Error('Failed to submit review');
        }
      }
    );
  }

  /**
   * Update business rating and review count
   */
  static async updateBusinessRating(businessId: string): Promise<void> {
    try {
      // Calculate average rating and count
      const { data: reviews, error } = await supabase
        .from('business_reviews')
        .select('rating')
        .eq('business_id', businessId);

      if (error) throw error;

      if (!reviews || reviews.length === 0) {
        // No reviews, set to null
        await supabase
          .from('businesses')
          .update({
            rating: null,
            review_count: 0,
          })
          .eq('id', businessId);
        return;
      }

      const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
      const averageRating = totalRating / reviews.length;

      // Update business
      await supabase
        .from('businesses')
        .update({
          rating: Math.round(averageRating * 100) / 100, // Round to 2 decimal places
          review_count: reviews.length,
        })
        .eq('id', businessId);

      Sentry.logger.info('Business rating updated', {
        businessId,
        averageRating,
        reviewCount: reviews.length,
      });
    } catch (error) {
      Sentry.captureException(error);
      console.error('Error updating business rating:', error);
      throw new Error('Failed to update business rating');
    }
  }

  /**
   * Get user's review for a specific transaction
   */
  static async getUserReviewForTransaction(
    userId: string,
    transactionId: string
  ): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('business_reviews')
        .select('*')
        .eq('user_id', userId)
        .eq('transaction_id', transactionId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 is "not found" error, which is expected
        throw error;
      }

      return data || null;
    } catch (error) {
      Sentry.captureException(error);
      console.error('Error fetching user review:', error);
      return null;
    }
  }

  /**
   * Get all reviews for a business
   */
  static async getBusinessReviews(businessId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('business_reviews')
        .select(`
          *,
          users!business_reviews_user_id_fkey(
            id,
            name,
            avatar_url
          )
        `)
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      Sentry.captureException(error);
      console.error('Error fetching business reviews:', error);
      return [];
    }
  }
}

