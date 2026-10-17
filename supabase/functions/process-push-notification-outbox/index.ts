import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Delivery = {
  id: string;
  user_id: string;
  device_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  expires_at: string;
  provider_ticket_id: string | null;
};

const preferenceMap: Record<string, string> = {
  message: "messages",
  message_reaction: "messages",
  marketplace_message: "messages",
  catalog_item_inquiry: "messages",
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
  ticket: "eventInvites",
  ticket_purchase: "eventInvites",
  ticket_confirmed: "eventInvites",
  marketplace_item_interest: "marketplaceUpdates",
  catalog_item_out_of_stock: "marketplaceUpdates",
  business_review_received: "marketplaceUpdates",
  marketplace_item_sold: "orderUpdates",
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
  safety: "safetyAlerts",
  alert: "safetyAlerts",
};

const headers = { "Content-Type": "application/json" };
const backoffSeconds = (attempt: number) =>
  Math.min(60 * 2 ** Math.max(0, attempt - 1), 3600);

function validServiceKey(req: Request): string | null {
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
  if (apiKey && (secretKeys.includes(apiKey) || apiKey === legacyKey))
    return apiKey;
  if (legacyKey && req.headers.get("authorization") === `Bearer ${legacyKey}`)
    return legacyKey;
  return null;
}

async function updateDelivery(
  admin: ReturnType<typeof createClient>,
  id: string,
  values: Record<string, unknown>,
) {
  const { error } = await admin
    .from("push_notification_deliveries")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const serviceKey = validServiceKey(req);
  if (!serviceKey)
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers,
    });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false },
  });
  const now = new Date();
  await admin
    .from("push_notification_deliveries")
    .update({
      status: "failed",
      last_error: "Notification expired before delivery",
      updated_at: now.toISOString(),
    })
    .in("status", ["queued", "sending", "awaiting_receipt"])
    .lte("expires_at", now.toISOString());

  const { data: receipts, error: receiptLoadError } = await admin
    .from("push_notification_deliveries")
    .select(
      "id, user_id, device_id, payload, attempt_count, expires_at, provider_ticket_id",
    )
    .eq("status", "awaiting_receipt")
    .lte("next_attempt_at", now.toISOString())
    .gt("expires_at", now.toISOString())
    .not("provider_ticket_id", "is", null)
    .limit(100);
  if (receiptLoadError)
    return new Response(JSON.stringify({ error: receiptLoadError.message }), {
      status: 500,
      headers,
    });

  let checkedReceipts = 0;
  const ticketIds = (receipts ?? [])
    .map((row: Delivery) => row.provider_ticket_id!)
    .filter(Boolean);
  if (ticketIds.length) {
    const receiptResponse = await fetch(
      "https://exp.host/--/api/v2/push/getReceipts",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: ticketIds }),
      },
    );
    if (!receiptResponse.ok)
      throw new Error(
        `Expo receipt service returned ${receiptResponse.status}`,
      );
    const receiptBody = await receiptResponse.json();
    const receiptMap = receiptBody.data ?? {};
    for (const delivery of (receipts ?? []) as Delivery[]) {
      const receipt = receiptMap[delivery.provider_ticket_id!];
      if (!receipt) {
        await updateDelivery(admin, delivery.id, {
          next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        });
        continue;
      }
      checkedReceipts += 1;
      if (receipt.status === "ok") {
        await updateDelivery(admin, delivery.id, {
          status: "delivered",
          delivered_at: new Date().toISOString(),
          last_error: null,
        });
      } else {
        const message =
          receipt.message ??
          receipt.details?.error ??
          "Expo could not deliver the notification";
        if (receipt.details?.error === "DeviceNotRegistered") {
          await admin
            .from("user_push_tokens")
            .delete()
            .eq("user_id", delivery.user_id)
            .eq("device_id", delivery.device_id);
          await updateDelivery(admin, delivery.id, {
            status: "failed",
            last_error: message,
          });
        } else if (
          delivery.attempt_count < 5 &&
          Date.parse(delivery.expires_at) > Date.now()
        ) {
          await updateDelivery(admin, delivery.id, {
            status: "queued",
            provider_ticket_id: null,
            last_error: message,
            next_attempt_at: new Date(
              Date.now() + backoffSeconds(delivery.attempt_count) * 1000,
            ).toISOString(),
          });
        } else {
          await updateDelivery(admin, delivery.id, {
            status: "failed",
            last_error: message,
          });
        }
      }
    }
  }

  const { data: jobs, error: claimError } = await admin.rpc(
    "claim_push_notification_deliveries",
    { p_limit: 100 },
  );
  if (claimError)
    return new Response(JSON.stringify({ error: claimError.message }), {
      status: 500,
      headers,
    });
  const claimed = (jobs ?? []) as Delivery[];
  let submitted = 0;
  let retried = 0;

  for (let offset = 0; offset < claimed.length; offset += 100) {
    const batch = claimed.slice(offset, offset + 100);
    const sendable: Array<{
      delivery: Delivery;
      token: string;
      message: Record<string, unknown>;
    }> = [];
    for (const delivery of batch) {
      const { data: recipient } = await admin
        .from("users")
        .select("notification_settings")
        .eq("id", delivery.user_id)
        .maybeSingle();
      const pushData = delivery.payload.data as
        Record<string, unknown> | undefined;
      const preference = preferenceMap[String(pushData?.type ?? "")];
      if (
        preference &&
        recipient?.notification_settings?.[preference] === false
      ) {
        await updateDelivery(admin, delivery.id, {
          status: "skipped",
          last_error: "Notification preference disabled before delivery",
        });
        continue;
      }
      const { data: tokenRow } = await admin
        .from("user_push_tokens")
        .select("push_token")
        .eq("user_id", delivery.user_id)
        .eq("device_id", delivery.device_id)
        .maybeSingle();
      if (!tokenRow?.push_token) {
        await updateDelivery(admin, delivery.id, {
          status: "failed",
          last_error: "Device token was removed or signed out",
        });
        continue;
      }
      sendable.push({
        delivery,
        token: tokenRow.push_token,
        message: {
          ...delivery.payload,
          ttl: Math.max(
            1,
            Math.floor((Date.parse(delivery.expires_at) - Date.now()) / 1000),
          ),
          to: tokenRow.push_token,
        },
      });
    }
    if (!sendable.length) continue;

    try {
      const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(sendable.map((item) => item.message)),
      });
      if (!expoResponse.ok)
        throw new Error(`Expo push service returned ${expoResponse.status}`);
      const result = await expoResponse.json();
      for (let i = 0; i < sendable.length; i += 1) {
        const { delivery, token } = sendable[i];
        const ticket = result.data?.[i];
        if (ticket?.status === "ok" && ticket.id) {
          await updateDelivery(admin, delivery.id, {
            status: "awaiting_receipt",
            provider_ticket_id: ticket.id,
            last_error: null,
            next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          });
          submitted += 1;
        } else {
          const message =
            ticket?.message ??
            ticket?.details?.error ??
            "Expo rejected the notification";
          if (ticket?.details?.error === "DeviceNotRegistered") {
            await admin
              .from("user_push_tokens")
              .delete()
              .eq("push_token", token);
            await updateDelivery(admin, delivery.id, {
              status: "failed",
              last_error: message,
            });
          } else if (
            delivery.attempt_count < 5 &&
            Date.parse(delivery.expires_at) > Date.now()
          ) {
            await updateDelivery(admin, delivery.id, {
              status: "queued",
              last_error: message,
              next_attempt_at: new Date(
                Date.now() + backoffSeconds(delivery.attempt_count) * 1000,
              ).toISOString(),
            });
            retried += 1;
          } else {
            await updateDelivery(admin, delivery.id, {
              status: "failed",
              last_error: message,
            });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const { delivery } of sendable) {
        if (
          delivery.attempt_count < 5 &&
          Date.parse(delivery.expires_at) > Date.now()
        ) {
          await updateDelivery(admin, delivery.id, {
            status: "queued",
            last_error: message,
            next_attempt_at: new Date(
              Date.now() + backoffSeconds(delivery.attempt_count) * 1000,
            ).toISOString(),
          });
          retried += 1;
        } else {
          await updateDelivery(admin, delivery.id, {
            status: "failed",
            last_error: message,
          });
        }
      }
    }
  }

  return new Response(
    JSON.stringify({ success: true, submitted, checkedReceipts, retried }),
    { status: 200, headers },
  );
});
