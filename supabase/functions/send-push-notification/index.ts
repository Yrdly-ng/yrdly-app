import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
  url?: string;
  badge?: number;
}

const SAFE_PUSH_DATA_KEYS = [
  "type",
  "notificationId",
  "recipientId",
  "relatedId",
  "relatedType",
  "url",
  "conversationId",
  "conversation_id",
  "postId",
  "post_id",
  "eventId",
  "event_id",
  "transactionId",
  "transaction_id",
  "disputeId",
  "dispute_id",
  "bookingId",
  "booking_id",
  "businessId",
  "business_id",
  "itemId",
  "item_id",
  "ticketId",
  "ticket_id",
  "fromUserId",
  "from_user_id",
  "profileId",
  "alertId",
  "alert_id",
  "id",
  "senderName",
  "fromUserName",
  "actor_count",
  "groupCount",
  "messageCount",
  "deliveryKey",
  "expiresAt",
  "expires_at",
  "appointmentTime",
  "appointment_time",
  "eventStartsAt",
  "event_starts_at",
  "eventDate",
  "event_date",
];

function safePushData(
  data: Record<string, unknown> | undefined,
  type?: string,
  url?: string,
) {
  const safeData: Record<string, unknown> = {};
  for (const key of SAFE_PUSH_DATA_KEYS) {
    if (data?.[key] !== undefined) safeData[key] = data[key];
  }
  if (type) safeData.type = type;
  if (url) safeData.url = url;
  return safeData;
}

function pushExpiry(
  data: Record<string, unknown> | undefined,
  type?: string,
): string {
  const explicitExpiry =
    data?.expiresAt ??
    data?.expires_at ??
    data?.appointmentTime ??
    data?.appointment_time ??
    data?.eventStartsAt ??
    data?.event_starts_at ??
    data?.eventDate ??
    data?.event_date;
  if (
    typeof explicitExpiry === "string" &&
    Number.isFinite(Date.parse(explicitExpiry))
  ) {
    return new Date(explicitExpiry).toISOString();
  }
  const shortLived = [
    "message",
    "message_reaction",
    "marketplace_message",
    "post_comment",
    "post_like",
    "mention",
  ].includes(type ?? "");
  return new Date(
    Date.now() + (shortLived ? 3600 : 86400) * 1000,
  ).toISOString();
}

serve(async (req) => {
  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let namedKeys: unknown;
  try {
    namedKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  } catch {
    namedKeys = {};
  }
  const secretKeys =
    namedKeys && typeof namedKeys === "object"
      ? Object.values(namedKeys).filter(
          (key): key is string =>
            typeof key === "string" && key.startsWith("sb_secret_"),
        )
      : [];
  const apiKey = req.headers.get("apikey");
  const serviceKey =
    apiKey && secretKeys.includes(apiKey)
      ? apiKey
      : legacyKey && req.headers.get("authorization") === `Bearer ${legacyKey}`
        ? legacyKey
        : null;
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: corsHeaders,
    });
  }
  try {
    const reader = req.body?.getReader();
    if (!reader) return new Response("Missing body", { status: 400 });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        return new Response("Payload too large", { status: 413 });
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    const { userId, payload, type } = JSON.parse(
      new TextDecoder().decode(body),
    ) as {
      userId: string;
      payload: PushPayload;
      type?: string;
    };

    if (
      typeof userId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(userId) ||
      !payload ||
      typeof payload.title !== "string" ||
      typeof payload.body !== "string"
    ) {
      return new Response(
        JSON.stringify({ error: "Missing userId or payload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Init Supabase admin client to read the user's push token
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
    );

    // Fetch notification preferences for this user from users table
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("notification_settings")
      .eq("id", userId)
      .single();

    // Fetch native device tokens and browser subscriptions. Web subscriptions
    // are separate from Expo tokens and must be sent with the Web Push protocol.
    const [tokenResult, webSubscriptionResult] = await Promise.all([
      supabaseAdmin
        .from("user_push_tokens")
        .select("device_id, push_token")
        .eq("user_id", userId),
      supabaseAdmin
        .from("push_subscriptions")
        .select("id, subscription")
        .eq("user_id", userId),
    ]);
    const { data: tokenRows, error: tokenError } = tokenResult;
    const { data: webSubscriptionRows, error: webSubscriptionError } =
      webSubscriptionResult;

    if (tokenError)
      console.error(
        `Could not load Expo tokens for ${userId}:`,
        tokenError.message,
      );
    if (webSubscriptionError)
      console.error(
        `Could not load web subscriptions for ${userId}:`,
        webSubscriptionError.message,
      );

    const validTokenRows = (tokenRows ?? []).filter(
      (row) =>
        row.push_token.startsWith("ExponentPushToken[") ||
        row.push_token.startsWith("ExpoPushToken["),
    );
    const validTokens = validTokenRows.map((row) => row.push_token);
    const webSubscriptions = webSubscriptionRows ?? [];

    if (validTokens.length === 0 && webSubscriptions.length === 0) {
      console.log(`No push subscriptions found for user ${userId}`);
      return new Response(
        JSON.stringify({ success: false, reason: "no_token" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Enforce notification preferences
    if (type && userData?.notification_settings) {
      const preferenceMap: Record<string, string> = {
        message: "messages",
        message_reaction: "messages",
        marketplace_message: "messages",
        catalog_item_inquiry: "messages",
        marketplace_item_interest: "marketplaceUpdates",
        marketplace_item_sold: "orderUpdates",
        catalog_item_out_of_stock: "marketplaceUpdates",
        business_review_received: "marketplaceUpdates",
        friend_request: "friendRequests",
        friend_request_accepted: "friendRequests",
        friend_request_declined: "friendRequests",
        new_follower: "friendRequests",
        post_comment: "comments",
        post_like: "postLikes",
        post_share: "postUpdates",
        mention: "postUpdates",
        community_update: "postUpdates",
        profile_view: "postUpdates",
        welcome: "postUpdates",
        system_announcement: "postUpdates",
        event_invite: "eventInvites",
        event_rsvp: "eventInvites",
        event_reminder: "eventInvites",
        event_updated: "eventInvites",
        event_cancelled: "eventInvites",
        ticket_confirmed: "eventInvites",
        ticket: "eventInvites",
        ticket_purchase: "eventInvites",
        item_shipped: "orderUpdates",
        delivery_confirmed: "orderUpdates",
        funds_released: "orderUpdates",
        payment_successful: "paymentReceived",
        payment_received: "paymentReceived",
        payment_refunded: "paymentReceived",
        payment_failed: "paymentReceived",
        payment: "paymentReceived",
        payout: "paymentReceived",
        payout_processed: "paymentReceived",
        payout_failed: "paymentReceived",
        dispute_opened: "disputeUpdates",
        dispute_resolved: "disputeUpdates",
        dispute: "disputeUpdates",
        appeal_decided: "disputeUpdates",
        booking_requested: "bookings",
        booking_confirmed: "bookings",
        booking_declined: "bookings",
        booking_cancelled: "bookings",
        booking_late_cancelled: "bookings",
        booking_no_show: "bookings",
        booking_reminder: "bookings",
        quote_estimated: "bookings",
        quote_converted: "bookings",
        safety_alert: "safetyAlerts",
        alert: "safetyAlerts",
        safety: "safetyAlerts",
      };

      const mappedKey = preferenceMap[type];

      if (mappedKey) {
        if (userData.notification_settings[mappedKey] === false) {
          console.log(
            `Push skipped: User opted out of ${mappedKey} (type: ${type})`,
          );
          return new Response(
            JSON.stringify({
              success: true,
              skipped: true,
              reason: "user_opt_out",
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            },
          );
        }
      } else {
        // Unmapped types fall through to default-send.
      }
    }

    const safeData = safePushData(payload.data, type, payload.url);
    const isPrivateMessage = [
      "message",
      "message_reaction",
      "marketplace_message",
      "catalog_item_inquiry",
    ].includes(type ?? "");
    const isPrivateAccountUpdate = [
      "payment_successful",
      "payment_received",
      "payment",
      "payment_refunded",
      "payment_failed",
      "payout",
      "payout_processed",
      "payout_failed",
      "item_shipped",
      "delivery_confirmed",
      "funds_released",
      "marketplace_item_sold",
      "dispute_opened",
      "dispute_resolved",
      "dispute",
      "appeal_decided",
    ].includes(type ?? "");
    const pushTitle = isPrivateMessage
      ? typeof safeData.fromUserName === "string"
        ? safeData.fromUserName
        : typeof safeData.senderName === "string"
          ? safeData.senderName
          : "New message"
      : isPrivateAccountUpdate
        ? "Account update"
        : payload.title;
    const messageCount = Number(
      safeData.messageCount ?? safeData.groupCount ?? 0,
    );
    const socialCount = Number(
      safeData.actor_count ?? safeData.groupCount ?? 0,
    );
    let pushBody = isPrivateMessage
      ? messageCount > 1
        ? `${messageCount} new messages`
        : "sent you a message"
      : isPrivateAccountUpdate
        ? "You have a private account update. Open YRDLY to view it."
        : payload.body;
    if (
      !isPrivateMessage &&
      !isPrivateAccountUpdate &&
      socialCount > 1 &&
      ["post_like", "post_comment", "post_share", "mention"].includes(
        type ?? "",
      ) &&
      !/\b\d+\s+other/i.test(pushBody)
    ) {
      pushBody = `${pushBody} (${socialCount} updates)`;
    }
    const collapseId =
      typeof safeData.conversationId === "string"
        ? `conversation-${safeData.conversationId}`
        : typeof safeData.postId === "string"
          ? `post-${safeData.postId}`
          : undefined;
    const expoPayload = {
      title: pushTitle,
      body: pushBody,
      sound: "default",
      badge: payload.badge ?? 1,
      data: safeData,
      ...(collapseId
        ? { collapseId, tag: collapseId, threadId: collapseId }
        : {}),
      ttl: [
        "message",
        "message_reaction",
        "marketplace_message",
        "post_comment",
        "post_like",
        "mention",
      ].includes(type ?? "")
        ? 3600
        : 86400,
      channelId: "default",
      priority: "high",
    };

    let queuedCount = 0;
    if (validTokenRows.length > 0) {
      const notificationId =
        typeof safeData.notificationId === "string" &&
        /^[0-9a-f-]{36}$/i.test(safeData.notificationId)
          ? safeData.notificationId
          : null;
      const dedupeKey =
        typeof safeData.deliveryKey === "string"
          ? safeData.deliveryKey
          : (notificationId ?? crypto.randomUUID());
      const expiry = pushExpiry(payload.data, type);
      const { data: queuedRows, error: queueError } = await supabaseAdmin
        .from("push_notification_deliveries")
        .upsert(
          validTokenRows.map((tokenRow) => ({
            notification_id: notificationId,
            user_id: userId,
            device_id: tokenRow.device_id,
            dedupe_key: dedupeKey,
            notification_type: type ?? "unknown",
            payload: expoPayload,
            status: "queued",
            next_attempt_at: new Date().toISOString(),
            expires_at: expiry,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "dedupe_key,device_id", ignoreDuplicates: true },
        )
        .select("id");
      if (queueError) throw queueError;
      queuedCount = queuedRows?.length ?? validTokenRows.length;
    }

    // Browser notifications remain immediate; native delivery is handled by the durable outbox worker.
    const webPayload = JSON.stringify({
      title: pushTitle,
      body: pushBody,
      icon: payload.icon ?? "/icon-192x192.png",
      badge: "/icon-192x192.png",
      data: safeData,
    });

    let webSent = 0;
    const vapidPublicKey =
      Deno.env.get("VAPID_PUBLIC_KEY") ??
      Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject =
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@yrdly.ng";

    if (webSubscriptions.length > 0 && vapidPublicKey && vapidPrivateKey) {
      try {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
        const results = await Promise.allSettled(
          webSubscriptions.map(async (row) => {
            try {
              await webpush.sendNotification(row.subscription, webPayload);
              webSent += 1;
            } catch (error) {
              const statusCode = (error as { statusCode?: number }).statusCode;
              if (statusCode === 404 || statusCode === 410) {
                await supabaseAdmin
                  .from("push_subscriptions")
                  .delete()
                  .eq("id", row.id);
              }
              throw error;
            }
          }),
        );
        const failures = results.filter(
          (result) => result.status === "rejected",
        ).length;
        if (failures > 0)
          console.error(
            `Web push failed for ${failures} subscription(s) for user ${userId}`,
          );
      } catch (error) {
        console.error("Could not send web push notifications:", error);
      }
    } else if (webSubscriptions.length > 0) {
      console.error(
        "Web push subscriptions exist but VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not configured",
      );
    }

    return new Response(
      JSON.stringify({
        success: webSent > 0 || queuedCount > 0,
        webSent,
        queuedNativeDevices: queuedCount,
        reason:
          webSent === 0 && queuedCount === 0 ? "delivery_failed" : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("send-push-notification error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
