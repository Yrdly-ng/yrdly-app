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
  "communityId",
  "community_id",
  "event",
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
  // Self-tests must not arrive hours later and be mistaken for live events.
  if (type === "push_test") return new Date(Date.now() + 120_000).toISOString();
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

  // The VAPID *public* key is intentionally accessible to web/PWA clients.
  // The private key and all POST/notification operations remain server-only.
  // This avoids relying on build-time Vercel environment configuration.
  if (req.method === "GET") {
    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ??
      Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    const available = Boolean(publicKey && Deno.env.get("VAPID_PRIVATE_KEY"));
    return new Response(
      JSON.stringify(available ? { publicKey } : { error: "web_push_unavailable" }),
      {
        status: available ? 200 : 503,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
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
    const { userId, payload, type, channel, targetDeviceId } = JSON.parse(
      new TextDecoder().decode(body),
    ) as {
      userId: string;
      payload: PushPayload;
      type?: string;
      channel?: "web" | "native" | "all";
      targetDeviceId?: string;
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

    // A native test may target only a specific locally registered device.
    // The caller is an authenticated server endpoint, not an untrusted SDK.
    if (channel === "native" &&
        (typeof targetDeviceId !== "string" ||
         !/^[0-9a-f-]{36}$/i.test(targetDeviceId))) {
      return new Response(JSON.stringify({ error: "native_device_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        .select("id, device_id, push_token")
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
        (!targetDeviceId || row.device_id === targetDeviceId) &&
        (row.push_token.startsWith("ExponentPushToken[") ||
        row.push_token.startsWith("ExpoPushToken[")),
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

    // Do not let callers bypass the editorial kill switch by omitting the
    // top-level type while placing daily_prompt inside payload.data.
    const isDailyPrompt = type === "daily_prompt" || payload.data?.type === "daily_prompt";
    // Keep editorial reminders OFF unless explicitly enabled at the
    // function runtime. Missing consent is always an opt-out.
    if (isDailyPrompt && Deno.env.get("DAILY_PROMPT_PUSH_ENABLED") !== "true") {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "campaign_paused" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (isDailyPrompt && userData?.notification_settings?.dailyPrompts !== true) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "user_opt_out" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce notification preferences
    if (type && userData?.notification_settings) {
      const preferenceMap: Record<string, string> = {
        daily_prompt: "dailyPrompts",
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
      ttl: type === "push_test" ? 120 : [
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
    let skippedNativeRegistrations = 0;
    // A native Expo token identifies one physical installation, even if an
    // old account or reinstall has left multiple database rows behind.
    // Avoid queuing duplicate or cross-account deliveries, and fail closed if
    // we cannot confirm which row is currently authoritative.
    let eligibleNativeTokenRows: typeof validTokenRows = [];
    if (validTokenRows.length > 0 && channel !== "web") {
      const uniqueTokens = [...new Set(validTokenRows.map((row) => row.push_token))];
      const { data: owners, error: ownerError } = await supabaseAdmin
        .from("user_push_tokens")
        .select("id,user_id,device_id,push_token")
        .in("push_token", uniqueTokens)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(2001);
      if (ownerError || !owners || owners.length >= 2001) {
        console.error("Native push token ownership cannot be confirmed; native delivery skipped");
        skippedNativeRegistrations = validTokenRows.length;
      } else {
        const latestByToken = new Map<string, typeof owners[number]>();
        for (const owner of owners) {
          if (!latestByToken.has(owner.push_token))
            latestByToken.set(owner.push_token, owner);
        }
        eligibleNativeTokenRows = validTokenRows.filter((row) => {
          const current = latestByToken.get(row.push_token);
          return !!current && current.id === row.id &&
            current.user_id === userId && current.device_id === row.device_id;
        });
        skippedNativeRegistrations = validTokenRows.length - eligibleNativeTokenRows.length;
        if (skippedNativeRegistrations)
          console.warn("Suppressed superseded native push registrations:", skippedNativeRegistrations);
      }
    }
    // A web self-test must never send notifications to native devices.
    if (eligibleNativeTokenRows.length > 0 && channel !== "web") {
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
          eligibleNativeTokenRows.map((tokenRow) => ({
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
      queuedCount = queuedRows?.length ?? eligibleNativeTokenRows.length;
    }

    // One browser endpoint is a single physical browser subscription. Older
    // account rows must not receive a different account's private messages.
    // PostgREST's JSON path filter matches the exact endpoint, including
    // subscriptions stored for other accounts. Fail closed on lookup errors.
    type BrowserSubscription = {
      id: string;
      user_id: string;
      subscription: { endpoint?: string; keys?: Record<string, string> };
      updated_at?: string | null;
      created_at?: string | null;
    };
    let eligibleWebSubscriptions: BrowserSubscription[] = [];
    let staleWebSubscriptions = 0;
    const endpoints = Array.from(new Set(
      (webSubscriptions as BrowserSubscription[])
        .map((row) => row.subscription?.endpoint)
        .filter((endpoint): endpoint is string =>
          typeof endpoint === "string" && endpoint.startsWith("https://")),
    ));
    if (endpoints.length) {
      const { data: owners, error: ownerError } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id, user_id, subscription, updated_at, created_at")
        .in("subscription->>endpoint", endpoints)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(2000);
      if (ownerError || !owners || owners.length >= 2000) {
        console.error("Web push ownership check unavailable; browser delivery skipped");
      } else {
        const latestByEndpoint = new Map<string, BrowserSubscription>();
        for (const candidate of owners as BrowserSubscription[]) {
          const endpoint = candidate.subscription?.endpoint;
          if (typeof endpoint === "string" && !latestByEndpoint.has(endpoint))
            latestByEndpoint.set(endpoint, candidate);
        }
        eligibleWebSubscriptions = (webSubscriptions as BrowserSubscription[])
          .filter((row) =>
            row.subscription?.endpoint &&
            latestByEndpoint.get(row.subscription.endpoint)?.id === row.id &&
            latestByEndpoint.get(row.subscription.endpoint)?.user_id === userId,
          );
        staleWebSubscriptions = webSubscriptions.length - eligibleWebSubscriptions.length;
        if (staleWebSubscriptions)
          console.warn("Web push suppressed stale account/browser subscription:", staleWebSubscriptions);
      }
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
    let webFailed = 0;
    let webPruned = 0;
    const failureCodes = new Map<string, number>();
    const vapidPublicKey =
      Deno.env.get("VAPID_PUBLIC_KEY") ??
      Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject =
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@yrdly.ng";

    if (channel !== "native" && eligibleWebSubscriptions.length > 0 && vapidPublicKey && vapidPrivateKey) {
      try {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
        const webTTL = type === "push_test" ? 120
          : ["message", "message_reaction", "marketplace_message"].includes(type ?? "")
          ? 3600 : 86400;
        const results = await Promise.allSettled(
          eligibleWebSubscriptions.map(async (row) => {
            try {
              // Provider acceptance != delivery to the user's browser.
              await webpush.sendNotification(row.subscription, webPayload, {
                TTL: webTTL,
                urgency: "normal",
              });
              webSent += 1;
            } catch (error) {
              const statusCode = (error as { statusCode?: number }).statusCode;
              const label = typeof statusCode === "number"
                ? String(statusCode) : "unknown";
              failureCodes.set(label, (failureCodes.get(label) ?? 0) + 1);
              if (statusCode === 404 || statusCode === 410) {
                // Expired endpoints cannot recover: remove this exact row.
                const { error: deleteError } = await supabaseAdmin
                  .from("push_subscriptions")
                  .delete()
                  .eq("id", row.id)
                  .eq("user_id", userId);
                if (!deleteError) webPruned += 1;
              }
              throw error;
            }
          }),
        );
        webFailed = results.filter((result) => result.status === "rejected").length;
        if (webFailed) {
          console.error("Web push provider rejected subscriptions:", JSON.stringify({
            failed: webFailed,
            statusCodes: Object.fromEntries(failureCodes),
          }));
        }
        console.info("Web push delivery summary:", JSON.stringify({
          acceptedByProvider: webSent,
          failed: webFailed,
          staleAccountSubscriptionsSkipped: staleWebSubscriptions,
          expiredSubscriptionsPruned: webPruned,
        }));
      } catch {
        console.error("Web push sender failed to initialize");
      }
    } else if (channel !== "native" && eligibleWebSubscriptions.length > 0) {
      console.error("Web push subscriptions exist but VAPID credentials are not configured");
    }

    return new Response(
      JSON.stringify({
        success: webSent > 0 || queuedCount > 0,
        webSent,
        webFailed,
        webSkippedStale: staleWebSubscriptions,
        webPruned,
        queuedNativeDevices: queuedCount,
        skippedNativeRegistrations,
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
