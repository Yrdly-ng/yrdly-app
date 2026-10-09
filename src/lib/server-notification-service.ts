import 'server-only';
import { NotificationService as BrowserNotificationService, type CreateNotificationParams } from './notification-service';
import { supabaseAdmin } from './supabase-admin';
import { sendPushNotification } from './server-push-notification';

export class NotificationService extends BrowserNotificationService {
  static async createNotification(params: CreateNotificationParams): Promise<string> {
    const { data, error } = await supabaseAdmin.rpc('create_notification', {
      p_user_id: params.userId, p_type: params.type, p_title: params.title,
      p_message: params.message, p_sender_id: params.senderId || null,
      p_related_id: params.relatedId || null, p_related_type: params.relatedType || null, p_data: params.data || {},
    });
    if (error) throw error;
    if (data?.should_push !== false) {
      await sendPushNotification(supabaseAdmin, params.userId, {
        title: params.title, body: data?.message || params.message, data: params.data,
      }, params.type).catch(error => console.warn('Notification saved; push delivery failed', error));
    }
    return typeof data === 'string' ? data : data?.id;
  }
}
