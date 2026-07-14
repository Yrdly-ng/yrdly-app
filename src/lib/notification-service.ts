import { supabase } from './supabase';
import { PushNotificationService } from './push-notification-service';

export interface NotificationData {
  id: string;
  user_id: string;
  type: NotificationType;
  sender_id?: string;
  related_id?: string;
  related_type?: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  is_read: boolean;
  read_at?: string;
  created_at: string;
  updated_at: string;
}

export type NotificationType = 
  | 'friend_request'
  | 'friend_request_accepted'
  | 'friend_request_declined'
  | 'message'
  | 'message_reaction'
  | 'post_like'
  | 'post_comment'
  | 'post_share'
  | 'event_invite'
  | 'event_reminder'
  | 'event_cancelled'
  | 'event_updated'
  | 'marketplace_item_sold'
  | 'marketplace_item_interest'
  | 'marketplace_message'
  | 'community_update'
  | 'system_announcement'
  | 'welcome'
  | 'profile_view'
  | 'mention'
  | 'payment_successful'
  | 'item_shipped'
  | 'delivery_confirmed'
  | 'funds_released'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'payout_processed'
  | 'payout_failed'
  | 'catalog_item_inquiry'
  | 'business_review_received'
  | 'catalog_item_out_of_stock';

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  senderId?: string;
  relatedId?: string;
  relatedType?: string;
  title: string;
  message: string;
  data?: Record<string, any>;
}

export class NotificationService {
  /**
   * Create a new notification
   */
  static async createNotification(params: CreateNotificationParams): Promise<string> {
    try {
      console.log('Creating notification:', params);
      
      // Try using the RPC function first
      const { data, error } = await supabase.rpc('create_notification', {
        p_user_id: params.userId,
        p_type: params.type,
        p_title: params.title,
        p_message: params.message,
        p_sender_id: params.senderId || null,
        p_related_id: params.relatedId || null,
        p_related_type: params.relatedType || null,
        p_data: params.data || {}
      });

      if (error) {
        console.error('Error creating notification via RPC:', error);
        throw error;
      }

      console.log('Notification created successfully via RPC:', data);

      // Send push notification
      try {
        await PushNotificationService.sendToUser(params.userId, {
          title: params.title,
          body: params.message,
          data: params.data,
          url: getNotificationUrl(params.type, params.relatedId),
          type: params.type
        });
      } catch (pushError) {
        console.error('Error sending push notification:', pushError);
        // Don't throw error - notification was created successfully
      }

      return data;
    } catch (rpcError) {
      console.log('RPC function failed, falling back to direct insert:', rpcError);
      
      // Fallback to direct insert if RPC function doesn't exist
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          user_id: params.userId,
          type: params.type,
          sender_id: params.senderId || null,
          related_id: params.relatedId || null,
          related_type: params.relatedType || null,
          title: params.title,
          message: params.message,
          data: params.data || {}
        })
        .select('id')
        .single();

      if (error) {
        console.error('Error creating notification via direct insert:', error);
        throw error;
      }

      console.log('Notification created successfully via direct insert:', data);

      // Send push notification
      try {
        await PushNotificationService.sendToUser(params.userId, {
          title: params.title,
          body: params.message,
          data: params.data,
          url: getNotificationUrl(params.type, params.relatedId),
          type: params.type
        });
      } catch (pushError) {
        console.error('Error sending push notification:', pushError);
        // Don't throw error - notification was created successfully
      }

      return data.id;
    }
  }

  /**
   * Get notifications for a user
   */
  static async getNotifications(userId: string, limit = 50, offset = 0): Promise<NotificationData[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching notifications:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Get unread notification count
   */
  static async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Error fetching unread count:', error);
      throw error;
    }

    return count || 0;
  }

  /**
   * Mark a notification as read
   */
  static async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    try {
      // Try using the RPC function first
      const { data, error } = await supabase.rpc('mark_notification_read', {
        p_notification_id: notificationId,
        p_user_id: userId
      });

      if (error) {
        console.error('Error marking notification as read via RPC:', error);
        throw error;
      }

      return data;
    } catch (rpcError) {
      
      // Fallback to direct update
      const { error } = await supabase
        .from('notifications')
        .update({ 
          is_read: true, 
          read_at: new Date().toISOString() 
        })
        .eq('id', notificationId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error marking notification as read via direct update:', error);
        throw error;
      }

      return true;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId: string): Promise<number> {
    try {
      // Try using the RPC function first
      const { data, error } = await supabase.rpc('mark_all_notifications_read', {
        p_user_id: userId
      });

      if (error) {
        console.error('Error marking all notifications as read via RPC:', error);
        throw error;
      }

      return data;
    } catch (rpcError) {
      
      // Fallback to direct update
      const { error } = await supabase
        .from('notifications')
        .update({ 
          is_read: true, 
          read_at: new Date().toISOString() 
        })
        .eq('user_id', userId)
        .eq('is_read', false);

      if (error) {
        console.error('Error marking all notifications as read via direct update:', error);
        throw error;
      }

      return 0; // We can't get the count easily with direct update
    }
  }

  /**
   * Clear all notifications for a user
   */
  static async clearAllNotifications(userId: string): Promise<number> {
    try {
      // Try using the RPC function first
      const { data, error } = await supabase.rpc('clear_all_notifications', {
        p_user_id: userId
      });

      if (error) {
        console.error('Error clearing all notifications via RPC:', error);
        throw error;
      }

      return data;
    } catch (rpcError) {
      
      // Fallback to direct delete
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', userId);

      if (error) {
        console.error('Error clearing all notifications via direct delete:', error);
        throw error;
      }

      return 0; // We can't get the count easily with direct delete
    }
  }

  /**
   * Delete a specific notification
   */
  static async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }

    return true;
  }

  /**
   * Get notification statistics for a user
   */
  static async getNotificationStats(userId: string) {
    const { data, error } = await supabase
      .from('notification_stats')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error fetching notification stats:', error);
      throw error;
    }

    return data;
  }

  /**
   * Create notification for friend request
   */
  static async createFriendRequestNotification(fromUserId: string, toUserId: string, fromUserName: string): Promise<string> {
    return this.createNotification({
      userId: toUserId,
      type: 'friend_request',
      senderId: fromUserId,
      relatedId: fromUserId,
      relatedType: 'user',
      title: 'New Friend Request',
      message: `${fromUserName} sent you a friend request`,
      data: { fromUserName }
    });
  }

  /**
   * Create notification for friend request accepted
   */
  static async createFriendRequestAcceptedNotification(fromUserId: string, toUserId: string, toUserName: string): Promise<string> {
    return this.createNotification({
      userId: fromUserId,
      type: 'friend_request_accepted',
      senderId: toUserId,
      relatedId: toUserId,
      relatedType: 'user',
      title: 'Friend Request Accepted',
      message: `${toUserName} accepted your friend request`,
      data: { toUserName }
    });
  }

  /**
   * Create notification for new message
   */
  static async createMessageNotification(
    toUserId: string, 
    fromUserId: string, 
    fromUserName: string, 
    conversationId: string, 
    messagePreview: string
  ): Promise<string> {
    return this.createNotification({
      userId: toUserId,
      type: 'message',
      senderId: fromUserId,
      relatedId: conversationId,
      relatedType: 'conversation',
      title: `New message from ${fromUserName}`,
      message: messagePreview,
      data: { fromUserName, conversationId, messagePreview }
    });
  }

  /**
   * Create notification for post like
   */
  static async createPostLikeNotification(
    postOwnerId: string, 
    likerId: string, 
    likerName: string, 
    postId: string
  ): Promise<string> {
    return this.createNotification({
      userId: postOwnerId,
      type: 'post_like',
      senderId: likerId,
      relatedId: postId,
      relatedType: 'post',
      title: `${likerName} liked your post`,
      message: `${likerName} liked your post`,
      data: { likerName, postId }
    });
  }

  /**
   * Create notification for post comment
   */
  static async createPostCommentNotification(
    postOwnerId: string, 
    commenterId: string, 
    commenterName: string, 
    postId: string, 
    commentPreview: string
  ): Promise<string> {
    return this.createNotification({
      userId: postOwnerId,
      type: 'post_comment',
      senderId: commenterId,
      relatedId: postId,
      relatedType: 'post',
      title: 'New comment on your post',
      message: `${commenterName} commented: "${commentPreview}"`,
      data: { commenterName, postId, commentPreview }
    });
  }

  /**
   * Create notification for event invite
   */
  static async createEventInviteNotification(
    inviteeId: string, 
    inviterId: string, 
    inviterName: string, 
    eventId: string, 
    eventTitle: string
  ): Promise<string> {
    return this.createNotification({
      userId: inviteeId,
      type: 'event_invite',
      senderId: inviterId,
      relatedId: eventId,
      relatedType: 'event',
      title: 'Event Invitation',
      message: `${inviterName} invited you to "${eventTitle}"`,
      data: { inviterName, eventId, eventTitle }
    });
  }

  /**
   * Create notification for marketplace item interest
   */
  static async createMarketplaceInterestNotification(
    sellerId: string, 
    buyerId: string, 
    buyerName: string, 
    itemId: string, 
    itemTitle: string
  ): Promise<string> {
    return this.createNotification({
      userId: sellerId,
      type: 'marketplace_item_interest',
      senderId: buyerId,
      relatedId: itemId,
      relatedType: 'marketplace_item',
      title: 'Interest in your item',
      message: `${buyerName} is interested in "${itemTitle}"`,
      data: { buyerName, itemId, itemTitle }
    });
  }

  /**
   * Create welcome notification for new users
   */
  static async createWelcomeNotification(userId: string, userName: string): Promise<string> {
    return this.createNotification({
      userId,
      type: 'welcome',
      title: 'Welcome to Yrdly!',
      message: `Welcome ${userName}! Start by exploring your neighborhood and connecting with neighbors.`,
      data: { userName }
    });
  }

  /**
   * Create system announcement notification
   */
  static async createSystemAnnouncementNotification(
    userId: string, 
    title: string, 
    message: string, 
    data?: Record<string, any>
  ): Promise<string> {
    return this.createNotification({
      userId,
      type: 'system_announcement',
      title,
      message,
      data
    });
  }

  /**
   * Create a payment successful notification
   */
  static async createPaymentSuccessfulNotification(
    sellerId: string,
    buyerName: string,
    itemTitle: string,
    amount: number,
    transactionId: string
  ): Promise<void> {
    await this.createNotification({
      userId: sellerId,
      type: 'payment_successful',
      relatedId: transactionId,
      relatedType: 'transaction',
      title: 'Payment Received!',
      message: `${buyerName} paid ₦${amount.toLocaleString()} for "${itemTitle}"`,
      data: {
        buyerName,
        itemTitle,
        amount,
        transactionId,
      },
    });
  }

  /**
   * Create an item shipped notification
   */
  static async createItemShippedNotification(
    buyerId: string,
    sellerName: string,
    itemTitle: string,
    transactionId: string
  ): Promise<void> {
    await this.createNotification({
      userId: buyerId,
      type: 'item_shipped',
      relatedId: transactionId,
      relatedType: 'transaction',
      title: 'Item Shipped!',
      message: `${sellerName} has shipped your order for "${itemTitle}"`,
      data: {
        sellerName,
        itemTitle,
        transactionId,
      },
    });
  }

  /**
   * Create a delivery confirmed notification
   */
  static async createDeliveryConfirmedNotification(
    sellerId: string,
    buyerName: string,
    itemTitle: string,
    transactionId: string
  ): Promise<void> {
    await this.createNotification({
      userId: sellerId,
      type: 'delivery_confirmed',
      relatedId: transactionId,
      relatedType: 'transaction',
      title: 'Delivery Confirmed!',
      message: `${buyerName} confirmed delivery of "${itemTitle}"`,
      data: {
        buyerName,
        itemTitle,
        transactionId,
      },
    });
  }

  /**
   * Create a funds released notification
   */
  static async createFundsReleasedNotification(
    sellerId: string,
    amount: number,
    itemTitle: string,
    transactionId: string
  ): Promise<void> {
    await this.createNotification({
      userId: sellerId,
      type: 'funds_released',
      relatedId: transactionId,
      relatedType: 'transaction',
      title: 'Funds Released!',
      message: `₦${amount.toLocaleString()} has been released to your account for "${itemTitle}"`,
      data: {
        amount,
        itemTitle,
        transactionId,
      },
    });
  }

  /**
   * Create a dispute opened notification
   */
  static async createDisputeOpenedNotification(
    userId: string,
    openedByName: string,
    itemTitle: string,
    disputeId: string,
    transactionId: string
  ): Promise<void> {
    await this.createNotification({
      userId: userId,
      type: 'dispute_opened',
      relatedId: disputeId,
      relatedType: 'dispute',
      title: 'Dispute Opened',
      message: `${openedByName} opened a dispute for "${itemTitle}"`,
      data: {
        openedByName,
        itemTitle,
        disputeId,
        transactionId,
      },
    });
  }

  /**
   * Create a dispute resolved notification
   */
  static async createDisputeResolvedNotification(
    userId: string,
    itemTitle: string,
    resolution: string,
    disputeId: string,
    transactionId: string
  ): Promise<void> {
    await this.createNotification({
      userId: userId,
      type: 'dispute_resolved',
      relatedId: disputeId,
      relatedType: 'dispute',
      title: 'Dispute Resolved',
      message: `Dispute for "${itemTitle}" has been resolved: ${resolution}`,
      data: {
        itemTitle,
        resolution,
        disputeId,
        transactionId,
      },
    });
  }

  /**
   * Create a payout processed notification
   */
  static async createPayoutProcessedNotification(
    sellerId: string,
    amount: number,
    payoutId: string
  ): Promise<void> {
    await this.createNotification({
      userId: sellerId,
      type: 'payout_processed',
      relatedId: payoutId,
      relatedType: 'payout',
      title: 'Payout Processed!',
      message: `₦${amount.toLocaleString()} has been sent to your account`,
      data: {
        amount,
        payoutId,
      },
    });
  }

  /**
   * Create a payout failed notification
   */
  static async createPayoutFailedNotification(
    sellerId: string,
    amount: number,
    reason: string,
    payoutId: string
  ): Promise<void> {
    await this.createNotification({
      userId: sellerId,
      type: 'payout_failed',
      relatedId: payoutId,
      relatedType: 'payout',
      title: 'Payout Failed',
      message: `Payout of ₦${amount.toLocaleString()} failed: ${reason}`,
      data: {
        amount,
        reason,
        payoutId,
      },
    });
  }

  /**
   * Create a catalog item inquiry notification (when customer messages about a catalog item)
   */
  static async createCatalogItemInquiryNotification(
    businessOwnerId: string,
    customerName: string,
    itemTitle: string,
    businessId: string,
    itemId: string
  ): Promise<void> {
    await this.createNotification({
      userId: businessOwnerId,
      type: 'catalog_item_inquiry',
      relatedId: itemId,
      relatedType: 'catalog_item',
      title: 'New Inquiry',
      message: `${customerName} is interested in "${itemTitle}"`,
      data: {
        customerName,
        itemTitle,
        businessId,
        itemId,
      },
    });
  }

  /**
   * Create a business review received notification
   */
  static async createBusinessReviewReceivedNotification(
    businessOwnerId: string,
    reviewerName: string,
    rating: number,
    businessId: string,
    reviewId: string
  ): Promise<void> {
    await this.createNotification({
      userId: businessOwnerId,
      type: 'business_review_received',
      relatedId: reviewId,
      relatedType: 'review',
      title: 'New Review Received',
      message: `${reviewerName} left a ${rating}-star review for your business`,
      data: {
        reviewerName,
        rating,
        businessId,
        reviewId,
      },
    });
  }

  /**
   * Create a catalog item out of stock reminder notification
   */
  static async createCatalogItemOutOfStockNotification(
    businessOwnerId: string,
    itemTitle: string,
    businessId: string,
    itemId: string
  ): Promise<void> {
    await this.createNotification({
      userId: businessOwnerId,
      type: 'catalog_item_out_of_stock',
      relatedId: itemId,
      relatedType: 'catalog_item',
      title: 'Item Out of Stock',
      message: `"${itemTitle}" is marked as out of stock. Update inventory to continue selling.`,
      data: {
        itemTitle,
        businessId,
        itemId,
      },
    });
  }
}

/**
 * Get notification URL based on type and related ID
 */
function getNotificationUrl(type: NotificationType, relatedId?: string | null): string {
  switch (type) {
    case 'friend_request':
    case 'friend_request_accepted':
    case 'friend_request_declined':
      return '/community';
    case 'message':
    case 'message_reaction':
      return relatedId ? `/messages/${relatedId}` : '/messages';
    case 'post_like':
    case 'post_comment':
    case 'post_share':
      return relatedId ? `/posts/${relatedId}` : '/home';
    case 'event_invite':
    case 'event_reminder':
    case 'event_cancelled':
    case 'event_updated':
      return '/events';
    case 'marketplace_item_sold':
    case 'marketplace_item_interest':
    case 'marketplace_message':
      return '/marketplace';
    case 'payment_successful':
    case 'item_shipped':
    case 'delivery_confirmed':
    case 'funds_released':
    case 'dispute_opened':
    case 'dispute_resolved':
    case 'payout_processed':
    case 'payout_failed':
      return relatedId ? `/transactions/${relatedId}` : '/transactions';
    case 'community_update':
    case 'system_announcement':
    case 'profile_view':
    case 'mention':
    case 'welcome':
    default:
      return '/home';
  }
}
