import { supabase } from './supabase';

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, any>;
  url?: string;
  type?: string;
}

export class PushNotificationService {
  /**
   * Send push notification to a specific user
   */
  static async sendToUser(userId: string, payload: PushNotificationPayload): Promise<boolean> {
    try {
      const { type, ...restPayload } = payload;
      // Invoke the Edge function to send push notification to mobile users
      supabase.functions.invoke('send-push-notification', {
        body: { userId, payload: restPayload, type }
      }).catch((err) => {
        console.error('Edge function error:', err);
      });

      // Handle local web notification on client
      if (typeof window !== 'undefined' && 'Notification' in window) {
        try {
          let perm = Notification.permission;
          if (perm === 'default') {
            perm = await Notification.requestPermission();
          }

          if (perm === 'granted') {
            const title = payload.title || 'Yrdly';
            const options: NotificationOptions = {
              body: payload.body || '',
              icon: payload.icon || '/icon-192x192.png',
              badge: payload.badge || '/icon-192x192.png',
              data: {
                ...payload.data,
                url: payload.url,
                timestamp: Date.now(),
              },
            };

            if ('serviceWorker' in navigator) {
              const registration = await navigator.serviceWorker.ready;
              if (registration && registration.showNotification) {
                await registration.showNotification(title, options);
              } else {
                new Notification(title, options);
              }
            } else {
              new Notification(title, options);
            }
          }
        } catch (swError) {
          console.error('Error displaying web notification:', swError);
        }
      }

      return true;
    } catch (error) {
      console.error('Error sending push notification:', error);
      return false;
    }
  }

  /**
   * Send push notification to multiple users
   */
  static async sendToUsers(userIds: string[], payload: PushNotificationPayload): Promise<number> {
    let successCount = 0;
    
    for (const userId of userIds) {
      const success = await this.sendToUser(userId, payload);
      if (success) successCount++;
    }
    
    return successCount;
  }

  /**
   * Send push notification to all users
   */
  static async sendToAllUsers(payload: PushNotificationPayload): Promise<number> {
    try {
      // Get all push subscriptions
      const { data: subscriptions, error } = await supabase
        .from('push_subscriptions')
        .select('user_id, subscription');

      if (error || !subscriptions) {
        console.error('Error fetching push subscriptions:', error);
        return 0;
      }

      let successCount = 0;
      for (const sub of subscriptions) {
        const success = await this.sendToUser(sub.user_id, payload);
        if (success) successCount++;
      }

      return successCount;
    } catch (error) {
      console.error('Error sending push notification to all users:', error);
      return 0;
    }
  }

  /**
   * Test push notification (for development)
   */
  static async testNotification(userId: string): Promise<boolean> {
    return this.sendToUser(userId, {
      title: 'Test Notification',
      body: 'This is a test push notification from Yrdly! 🔔',
      url: '/home'
    });
  }
}

