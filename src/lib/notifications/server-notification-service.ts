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
      // The sender name must be resolved server-side, never trusted from a client
      // supplied payload. Only social messages need a visible lock-screen actor.
      const shouldNameSender = [
        "message",
        "message_reaction",
        "marketplace_message",
        "catalog_item_inquiry",
      ].includes(params.type);
      const { data: senderProfile } =
        shouldNameSender && params.senderId
          ? await supabaseAdmin
              .from("users")
              .select("name")
              .eq("id", params.senderId)
              .maybeSingle()
          : { data: null };
      const fromUserName =
        typeof senderProfile?.name === "string"
          ? senderProfile.name.trim().slice(0, 80)
          : "";
      // Some existing callers provide relatedId but not conversationId.
      const resolvedConversationId =
        typeof params.data?.conversationId === "string"
          ? params.data.conversationId
          : params.relatedType === "conversation"
            ? params.relatedId
            : undefined;
      const deliveryKey =
        typeof params.data?.messageId === "string"
          ? `${notificationId}:${params.data.messageId}`
          : typeof params.data?.eventId === "string"
            ? `${notificationId}:${params.data.eventId}`
            : `${notificationId}:${crypto.randomUUID()}`;
      const conversationId = resolvedConversationId;
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
            ...(fromUserName ? { fromUserName } : {}),
            ...(params.senderId && shouldNameSender
              ? { fromUserId: params.senderId }
              : {}),
            ...(conversationId ? { conversationId } : {}),
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
