import "server-only";
import {
  NotificationService as BrowserNotificationService,
  type CreateNotificationParams,
} from "./notification-service";
import { supabaseAdmin } from "../supabase/supabase-admin";
import { sendPushNotification } from "./server-push-notification";

export class NotificationService extends BrowserNotificationService {
  static async createNotification(
    params: CreateNotificationParams,
  ): Promise<string> {
    const { data, error } = await supabaseAdmin.rpc("create_notification", {
      p_user_id: params.userId,
      p_type: params.type,
      p_title: params.title,
      p_message: params.message,
      p_sender_id: params.senderId || null,
      p_related_id: params.relatedId || null,
      p_related_type: params.relatedType || null,
      p_data: params.data || {},
    });
    if (error) throw error;
    if (data?.should_push !== false) {
      const notificationId = typeof data === "string" ? data : data?.id;
      const storedNotification = notificationId
        ? await supabaseAdmin
            .from("notifications")
            .select("data")
            .eq("id", notificationId)
            .maybeSingle()
        : { data: null };
      const actorCount = storedNotification.data?.data?.actor_count;
      const deliveryKey =
        typeof params.data?.messageId === "string"
          ? `${notificationId}:${params.data.messageId}`
          : typeof params.data?.eventId === "string"
            ? `${notificationId}:${params.data.eventId}`
            : `${notificationId}:${crypto.randomUUID()}`;
      const conversationId = params.data?.conversationId;
      const messageCount =
        (params.type === "message" || params.type === "marketplace_message") &&
        typeof conversationId === "string" &&
        params.senderId
          ? await supabaseAdmin
              .from("messages")
              .select("read_by")
              .eq("conversation_id", conversationId)
              .neq("sender_id", params.userId)
              .gte("created_at", new Date(Date.now() - 60_000).toISOString())
              .then(({ data: messages }) =>
                Math.max(
                  1,
                  (messages ?? []).filter(
                    (message) => !message.read_by?.includes(params.userId),
                  ).length,
                ),
              )
          : undefined;
      await sendPushNotification(
        supabaseAdmin,
        params.userId,
        {
          title: params.title,
          body: data?.message || params.message,
          data: {
            ...(params.data || {}),
            ...(messageCount ? { messageCount } : {}),
            ...(actorCount ? { actor_count: actorCount } : {}),
            type: params.type,
            notificationId,
            deliveryKey,
            recipientId: params.userId,
            relatedId: params.relatedId,
            relatedType: params.relatedType,
          },
        },
        params.type,
      ).catch((error) =>
        console.warn("Notification saved; push delivery failed", error),
      );
    }
    return typeof data === "string" ? data : data?.id;
  }
}
