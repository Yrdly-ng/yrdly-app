import { NotificationService } from './notification-service';
import { supabase } from './supabase';

/**
 * Notification Triggers - Automatically create notifications for app events
 * This ensures all user actions generate appropriate notifications
 */

export class NotificationTriggers {
  /**
   * Trigger notification when a friend request is sent
   */
  static async onFriendRequestSent(fromUserId: string, toUserId: string) {
    try {
      // Get sender's name
      const { data: senderData } = await supabase
        .from('users')
        .select('name')
        .eq('id', fromUserId)
        .single();

      if (senderData) {
        await NotificationService.createNotification({
          userId: toUserId,
          type: 'friend_request',
          senderId: fromUserId,
          relatedId: fromUserId,
          relatedType: 'user',
          title: 'New Friend Request',
          message: `New friend request from ${senderData.name}`,
          data: { fromUserName: senderData.name }
        });
      }
    } catch (error) {
      console.error('Error creating friend request notification:', error);
    }
  }

  /**
   * Trigger notification when a friend request is accepted
   */
  static async onFriendRequestAccepted(fromUserId: string, toUserId: string) {
    try {
      // Get acceptor's name
      const { data: acceptorData } = await supabase
        .from('users')
        .select('name')
        .eq('id', toUserId)
        .single();

      if (acceptorData) {
        await NotificationService.createNotification({
          userId: fromUserId,
          type: 'friend_request_accepted',
          senderId: toUserId,
          relatedId: toUserId,
          relatedType: 'user',
          title: 'Friend Request Accepted',
          message: `${acceptorData.name} accepted your friend request`,
          data: { acceptorName: acceptorData.name }
        });
      }
    } catch (error) {
      console.error('Error creating friend request accepted notification:', error);
    }
  }

  /**
   * Trigger notification when a message is sent
   */
  static async onMessageSent(
    toUserId: string,
    fromUserId: string,
    conversationId: string,
    messageContent: string
  ) {
    try {
      
      // Debounce: Check for recent notifications in the last 60 seconds to prevent spam
      const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
      const { data: recentNotifs } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', toUserId)
        .eq('type', 'message')
        .eq('sender_id', fromUserId)
        .eq('related_id', conversationId)
        .gte('created_at', oneMinuteAgo)
        .limit(1);

      if (recentNotifs && recentNotifs.length > 0) {
         return;
      }

      // Get sender's name
      const { data: senderData } = await supabase
        .from('users')
        .select('name')
        .eq('id', fromUserId)
        .single();

      if (senderData) {
        const messagePreview = messageContent.length > 50 
          ? messageContent.substring(0, 50) + '...' 
          : messageContent;


        await NotificationService.createNotification({
          userId: toUserId,
          type: 'message',
          senderId: fromUserId,
          relatedId: conversationId,
          relatedType: 'conversation',
          title: `New message from ${senderData.name}`,
          message: messagePreview,
          data: { 
            fromUserName: senderData.name, 
            conversationId, 
            messagePreview 
          }
        });
      } else {
      }
    } catch (error) {
      console.error('Error creating message notification:', error);
    }
  }

  /**
   * Trigger notification when a post is liked
   */
  static async onPostLiked(postId: string, likerId: string) {
    try {
      // Get post details and owner
      const { data: postData } = await supabase
        .from('posts')
        .select('user_id')
        .eq('id', postId)
        .single();

      if (postData && postData.user_id !== likerId) {
        // Get liker's name
        const { data: likerData } = await supabase
          .from('users')
          .select('name')
          .eq('id', likerId)
          .single();

        if (likerData) {
          await NotificationService.createNotification({
            userId: postData.user_id,
            type: 'post_like',
            senderId: likerId,
            relatedId: postId,
            relatedType: 'post',
            title: `${likerData.name} liked your post`,
            message: `${likerData.name} liked your post`,
            data: { likerName: likerData.name, postId }
          });
        }
      }
    } catch (error) {
      console.error('Error creating post like notification:', error);
    }
  }

  /**
   * Trigger removal of like actor when a post is unliked
   */
  static async onPostUnliked(postId: string, userId: string) {
    try {
      const { data: post } = await supabase.from('posts').select('user_id').eq('id', postId).single();
      if (!post || post.user_id === userId) return;
      await NotificationService.removeNotificationActor({
        userId: post.user_id,
        type: 'post_like',
        senderId: userId,
        relatedId: postId
      });
    } catch (e) {
      console.error('Error removing like notification actor:', e);
    }
  }

  /**
   * Trigger notification when a post is commented on
   */
  static async onPostCommented(postId: string, commenterId: string, commentContent: string) {
    try {
      // Get post details and owner
      const { data: postData } = await supabase
        .from('posts')
        .select('user_id')
        .eq('id', postId)
        .single();

      if (postData && postData.user_id !== commenterId) {
        // Get commenter's name
        const { data: commenterData } = await supabase
          .from('users')
          .select('name')
          .eq('id', commenterId)
          .single();

        if (commenterData) {
          const commentPreview = commentContent.length > 50 
            ? commentContent.substring(0, 50) + '...' 
            : commentContent;

          await NotificationService.createNotification({
            userId: postData.user_id,
            type: 'post_comment',
            senderId: commenterId,
            relatedId: postId,
            relatedType: 'post',
            title: `${commenterData.name} commented on your post`,
            message: `${commenterData.name} commented: "${commentPreview}"`,
            data: { commenterName: commenterData.name, postId, commentPreview }
          });
        }
      }
    } catch (error) {
      console.error('Error creating post comment notification:', error);
    }
  }

  /**
   * Trigger notification when someone is interested in a marketplace item
   */
  static async onMarketplaceItemInterest(itemId: string, buyerId: string) {
    try {
      // Get item details and seller
      const { data: itemData } = await supabase
        .from('posts')
        .select('user_id, text, title')
        .eq('id', itemId)
        .eq('category', 'For Sale')
        .single();

      if (itemData && itemData.user_id !== buyerId) {
        // Get buyer's name
        const { data: buyerData } = await supabase
          .from('users')
          .select('name')
          .eq('id', buyerId)
          .single();

        if (buyerData) {
          await NotificationService.createMarketplaceInterestNotification(
            itemData.user_id,
            buyerId,
            buyerData.name,
            itemId,
            itemData.title || itemData.text
          );
        }
      }
    } catch (error) {
      console.error('Error creating marketplace interest notification:', error);
    }
  }

  /**
   * Trigger notification when a user is mentioned in a post or comment
   */
  static async onUserMentioned(mentionedUserId: string, mentionerId: string, postId: string, content: string) {
    try {
      // Get mentioner's name
      const { data: mentionerData } = await supabase
        .from('users')
        .select('name')
        .eq('id', mentionerId)
        .single();

      if (mentionerData) {
        await NotificationService.createNotification({
          userId: mentionedUserId,
          type: 'mention',
          senderId: mentionerId,
          relatedId: postId,
          relatedType: 'post',
          title: 'You were mentioned',
          message: `${mentionerData.name} mentioned you in a post`,
          data: { mentionerName: mentionerData.name, postId, content }
        });
      }
    } catch (error) {
      console.error('Error creating mention notification:', error);
    }
  }

  /**
   * Trigger notification when an event is created and users are invited
   */
  static async onEventInvite(eventId: string, inviterId: string, inviteeIds: string[], eventTitle: string) {
    try {
      // Get inviter's name
      const { data: inviterData } = await supabase
        .from('users')
        .select('name')
        .eq('id', inviterId)
        .single();

      if (inviterData) {
        // Create notifications for all invitees
        const notificationPromises = inviteeIds.map(inviteeId => 
          NotificationService.createEventInviteNotification(
            inviteeId,
            inviterId,
            inviterData.name,
            eventId,
            eventTitle
          )
        );

        await Promise.all(notificationPromises);
      }
    } catch (error) {
      console.error('Error creating event invite notifications:', error);
    }
  }

  /**
   * Trigger welcome notification for new users
   */
  static async onUserSignup(userId: string, userName: string) {
    try {
      await NotificationService.createWelcomeNotification(userId, userName);
    } catch (error) {
      console.error('Error creating welcome notification:', error);
    }
  }

  /**
   * Trigger notification when a marketplace item is sold
   */
  static async onMarketplaceItemSold(itemId: string, sellerId: string, buyerId: string, itemTitle: string) {
    try {
      // Get buyer's name
      const { data: buyerData } = await supabase
        .from('users')
        .select('name')
        .eq('id', buyerId)
        .single();

      if (buyerData) {
        await NotificationService.createNotification({
          userId: sellerId,
          type: 'marketplace_item_sold',
          senderId: buyerId,
          relatedId: itemId,
          relatedType: 'marketplace_item',
          title: 'Item Sold!',
          message: `${buyerData.name} purchased "${itemTitle}"`,
          data: { buyerName: buyerData.name, itemId, itemTitle }
        });
      }
    } catch (error) {
      console.error('Error creating marketplace sold notification:', error);
    }
  }

  /**
   * Trigger notification for community updates
   */
  static async onCommunityUpdate(userIds: string[], title: string, message: string, data?: Record<string, any>) {
    try {
      const notificationPromises = userIds.map(userId =>
        NotificationService.createNotification({
          userId,
          type: 'community_update',
          title,
          message,
          data
        })
      );

      await Promise.all(notificationPromises);
    } catch (error) {
      console.error('Error creating community update notifications:', error);
    }
  }

  /**
   * Trigger notification for system announcements
   */
  static async onSystemAnnouncement(userIds: string[], title: string, message: string, data?: Record<string, any>) {
    try {
      const notificationPromises = userIds.map(userId =>
        NotificationService.createNotification({
          userId,
          type: 'system_announcement',
          title,
          message,
          data
        })
      );

      await Promise.all(notificationPromises);
    } catch (error) {
      console.error('Error creating system announcement notifications:', error);
    }
  }

  /**
   * Trigger notification when someone views a user's profile
   * Profile view notifications are disabled.
   */
  static async onProfileView(_viewedUserId: string, _viewerId: string) {
    // Profile view notifications intentionally disabled
  }

  /**
   * Trigger notification when a booking request is created
   */
  static async onBookingRequested(params: {
    bookingId: string;
    customerUserId?: string;
    providerBusinessId?: string;
    providerOwnerId?: string;
    serviceName?: string;
    bookingDate?: string;
    startTime?: string;
    [key: string]: any;
  }) {
    try {
      let targetUserId = params.providerOwnerId;
      if (!targetUserId && params.providerBusinessId) {
        const { data: bus } = await supabase
          .from('businesses')
          .select('user_id')
          .eq('id', params.providerBusinessId)
          .single();
        targetUserId = bus?.user_id;
      }

      if (targetUserId) {
        let customerName = params.customerName;
        if (!customerName && params.customerUserId) {
          const { data: customer } = await supabase
            .from('users')
            .select('name')
            .eq('id', params.customerUserId)
            .single();
          customerName = customer?.name;
        }

        await NotificationService.createNotification({
          userId: targetUserId,
          type: 'booking_requested',
          senderId: params.customerUserId,
          relatedId: params.bookingId,
          relatedType: 'booking',
          title: 'New Booking Request',
          message: `${customerName || 'A customer'} requested ${params.serviceName || 'a service'}`,
          data: params,
        });
      }
    } catch (error) {
      console.error('Error creating booking_requested notification:', error);
    }
  }

  /**
   * Trigger notification when a booking is confirmed by provider
   */
  static async onBookingConfirmed(params: {
    bookingId: string;
    customerUserId?: string;
    customerId?: string;
    serviceName?: string;
    bookingDate?: string;
    startTime?: string;
    [key: string]: any;
  }) {
    try {
      const recipientId = params.customerUserId || params.customerId;
      if (recipientId) {
        await NotificationService.createNotification({
          userId: recipientId,
          type: 'booking_confirmed',
          relatedId: params.bookingId,
          relatedType: 'booking',
          title: 'Booking Confirmed!',
          message: `Your booking for ${params.serviceName || 'service'} has been confirmed.`,
          data: params,
        });
      }
    } catch (error) {
      console.error('Error creating booking_confirmed notification:', error);
    }
  }

  /**
   * Trigger notification when a booking is cancelled
   */
  static async onBookingCancelled(params: {
    bookingId: string;
    customerUserId?: string;
    providerBusinessId?: string;
    serviceName?: string;
    cancelledByUserId?: string;
    targetUserId?: string;
    reason?: string;
    [key: string]: any;
  }) {
    try {
      let recipientId = params.targetUserId;
      if (!recipientId && params.providerBusinessId) {
        const { data: bus } = await supabase
          .from('businesses')
          .select('user_id')
          .eq('id', params.providerBusinessId)
          .single();

        recipientId = params.cancelledByUserId === params.customerUserId
          ? bus?.user_id
          : params.customerUserId;
      }

      if (recipientId) {
        await NotificationService.createNotification({
          userId: recipientId,
          type: 'booking_cancelled',
          senderId: params.cancelledByUserId,
          relatedId: params.bookingId,
          relatedType: 'booking',
          title: 'Booking Cancelled',
          message: `Booking for ${params.serviceName || 'service'} was cancelled.${params.reason ? ` Reason: ${params.reason}` : ''}`,
          data: params,
        });
      }
    } catch (error) {
      console.error('Error creating booking_cancelled notification:', error);
    }
  }

  /**
   * Trigger notification when a customer is marked as no-show
   */
  static async onBookingNoShow(params: {
    bookingId: string;
    customerUserId?: string;
    targetUserId?: string;
    serviceName?: string;
    strikeAdded?: boolean;
    currentStrikeCount?: number;
    [key: string]: any;
  }) {
    try {
      const recipientId = params.targetUserId || params.customerUserId;
      if (recipientId) {
        await NotificationService.createNotification({
          userId: recipientId,
          type: 'booking_no_show',
          relatedId: params.bookingId,
          relatedType: 'booking',
          title: 'Marked as No-Show',
          message: `You were marked as no-show for ${params.serviceName || 'service'}.${params.currentStrikeCount !== undefined ? ` Total strikes: ${params.currentStrikeCount}` : ''}`,
          data: params,
        });
      }
    } catch (error) {
      console.error('Error creating booking_no_show notification:', error);
    }
  }
}

