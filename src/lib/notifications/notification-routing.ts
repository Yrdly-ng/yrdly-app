type NotificationRouteInput = {
  type: string;
  relatedType?: string | null;
  related_type?: string | null;
  relatedId?: string | null;
  data?: Record<string, any> | null;
};

const firstId = (...values: unknown[]): string | undefined =>
  values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

/** Accept persisted rows, native push data, and the nested web-push envelope. */
export function normalizeNotificationPayload(
  input: Record<string, any>,
): Record<string, any> {
  const nested =
    input.data && typeof input.data === "object" && !Array.isArray(input.data)
      ? input.data
      : {};
  const data = { ...nested, ...input };
  data.relatedId = firstId(
    input.relatedId,
    input.related_id,
    nested.relatedId,
    nested.related_id,
  );
  data.relatedType = firstId(
    input.relatedType,
    input.related_type,
    nested.relatedType,
    nested.related_type,
  );
  data.fromUserId = firstId(
    data.fromUserId,
    data.from_user_id,
    input.sender_id,
  );
  return data;
}

export function getNotificationDestination(
  input: NotificationRouteInput,
): string {
  const data = normalizeNotificationPayload(input);
  const { type, relatedId } = data;
  if (
    type === "payment_successful" &&
    !data.transactionId &&
    !data.transaction_id &&
    (data.bookingId || data.booking_id || data.relatedType === "booking")
  ) {
    const id = firstId(data.bookingId, data.booking_id, relatedId);
    return id ? `/bookings/${id}` : "/bookings";
  }
  switch (type) {
    case "friend_request":
    case "friend_request_accepted":
    case "friend_request_declined":
    case "new_follower": {
      const profileId = firstId(
        data?.fromUserId,
        data?.from_user_id,
        relatedId,
      );
      return profileId ? `/profile/${profileId}` : "/community";
    }
    case "message":
    case "message_reaction": {
      const conversationId = firstId(
        data?.conversationId,
        data?.conversation_id,
        relatedId,
      );
      return conversationId ? `/messages/${conversationId}` : "/messages";
    }
    case "post_like":
    case "post_comment":
    case "post_share":
    case "mention": {
      const postId = firstId(data?.postId, data?.post_id, relatedId);
      return postId ? `/posts/${postId}` : "/home";
    }
    case "event_team":
    case "event_team_invite":
    case "event_team_updated":
      return "/events/team";
    case "event_cancelled": {
      const eventId = firstId(data?.eventId, data?.event_id);
      if (eventId) return `/events/${eventId}`;
      if (firstId(data?.ticketId, data?.ticket_id)) return "/my-tickets";
      return relatedId ? `/events/${relatedId}` : "/events";
    }
    case "event_invite":
    case "event_reminder":
    case "event_updated": {
      const eventId = firstId(data?.eventId, data?.event_id, relatedId);
      return eventId ? `/events/${eventId}` : "/events";
    }
    case "ticket":
    case "ticket_purchase":
    case "ticket_confirmed":
    case "event_rsvp":
      return "/my-tickets";
    case "catalog_item_inquiry":
    case "catalog_item_out_of_stock": {
      if (
        data.relatedType === "conversation" ||
        data.conversationId ||
        data.conversation_id
      ) {
        const id = firstId(
          data.conversationId,
          data.conversation_id,
          relatedId,
        );
        return id ? `/messages/${id}` : "/messages";
      }
      const businessId = firstId(data?.businessId, data?.business_id);
      const itemId = firstId(data?.itemId, data?.item_id, relatedId);
      return businessId && itemId
        ? `/businesses/${businessId}/catalog/${itemId}`
        : businessId
          ? `/businesses/${businessId}`
          : "/businesses";
    }
    case "business_review_received": {
      const businessId = firstId(data?.businessId, data?.business_id);
      return businessId
        ? `/businesses/${businessId}?tab=reviews`
        : "/businesses";
    }
    case "booking_requested":
    case "booking_confirmed":
    case "booking_declined":
    case "booking_late_cancelled":
    case "booking_reminder":
    case "booking_cancelled":
    case "booking_no_show": {
      const bookingId = firstId(data?.bookingId, data?.booking_id, relatedId);
      return bookingId ? `/bookings/${bookingId}` : "/bookings";
    }
    case "appeal_decided": {
      const bookingId = firstId(data?.bookingId, data?.booking_id);
      return bookingId ? `/bookings/${bookingId}` : "/bookings";
    }
    case "quote_estimated":
    case "quote_converted": {
      const id = firstId(data.bookingId, data.booking_id);
      return id ? `/bookings/${id}` : "/bookings";
    }
    case "marketplace_message": {
      const conversationId = firstId(
        data?.conversationId,
        data?.conversation_id,
        relatedId,
      );
      return conversationId ? `/messages/${conversationId}` : "/messages";
    }
    case "marketplace_item_sold":
    case "marketplace_item_interest": {
      const itemId = firstId(data?.itemId, data?.item_id, relatedId);
      return itemId ? `/marketplace/${itemId}` : "/marketplace";
    }
    case "payment_successful":
    case "payment_refunded":
    case "item_shipped":
    case "delivery_confirmed":
    case "funds_released": {
      const transactionId = firstId(
        data?.transactionId,
        data?.transaction_id,
        relatedId,
      );
      return transactionId ? `/transactions/${transactionId}` : "/transactions";
    }
    case "dispute_opened":
    case "dispute_resolved": {
      const disputeId = firstId(data?.disputeId, data?.dispute_id, relatedId);
      return disputeId ? `/disputes/${disputeId}` : "/disputes";
    }
    case "payout_processed":
    case "payout_failed": {
      const payoutId = firstId(
        data.payoutId,
        data.payout_id,
        data.relatedType === "escrow_transaction" ? undefined : relatedId,
      );
      if (payoutId) return `/profile/payouts/${encodeURIComponent(payoutId)}`;
      const transactionId = firstId(
        data.transactionId,
        data.transaction_id,
        data.relatedType === "escrow_transaction" ? relatedId : undefined,
      );
      return transactionId
        ? `/transactions/${encodeURIComponent(transactionId)}`
        : "/profile/payouts";
    }
    case "safety_alert":
    case "alert": {
      const alertId = firstId(
        data?.alertId,
        data?.alert_id,
        relatedId,
        data?.id,
      );
      return alertId ? `/alerts/${alertId}` : "/alerts";
    }
    case "community_update": {
      const cid = firstId(data?.communityId, data?.community_id, relatedId);
      const pid = firstId(data?.postId, data?.post_id);
      return cid
        ? pid
          ? `/communities/${cid}/posts/${pid}`
          : `/communities/${cid}`
        : "/communities";
    }
    case "profile_view": {
      const id = firstId(data.fromUserId, relatedId);
      return id ? `/profile/${id}` : "/notifications";
    }
    case "welcome":
    case "system_announcement":
    default:
      return "/notifications";
  }
}

export function getNotificationTarget(data: Record<string, unknown>): {
  table: string;
  id: string;
  fallback: string;
} | null {
  data = normalizeNotificationPayload(data);
  const type = typeof data.type === "string" ? data.type : "";
  if (["payout_processed", "payout_failed"].includes(type)) {
    const id = firstId(
      data.payoutId,
      data.payout_id,
      data.relatedType === "escrow_transaction" ? undefined : data.relatedId,
    );
    if (id)
      return { table: "payout_requests", id, fallback: "/profile/payouts" };
    const transactionId = firstId(
      data.transactionId,
      data.transaction_id,
      data.relatedType === "escrow_transaction" ? data.relatedId : undefined,
    );
    return transactionId
      ? {
          table: "escrow_transactions",
          id: transactionId,
          fallback: "/transactions",
        }
      : null;
  }
  if (
    (type === "payment_successful" &&
      !data.transactionId &&
      !data.transaction_id &&
      (data.bookingId || data.booking_id || data.relatedType === "booking")) ||
    type === "quote_converted"
  ) {
    const id = firstId(
      data.bookingId,
      data.booking_id,
      data.relatedType === "booking" ? data.relatedId : undefined,
    );
    return id ? { table: "bookings", id, fallback: "/bookings" } : null;
  }
  if (type === "community_update") {
    const communityId = firstId(
      data.communityId,
      data.community_id,
      data.relatedId,
    );
    const postId = firstId(data.postId, data.post_id);
    if (!communityId)
      return data.url ? getNotificationTarget({ url: data.url }) : null;
    return postId
      ? {
          table: "community_posts",
          id: postId,
          fallback: `/communities/${communityId}`,
        }
      : { table: "communities", id: communityId, fallback: "/communities" };
  }
  if (
    ["message", "message_reaction", "marketplace_message"].includes(type) ||
    (type === "catalog_item_inquiry" &&
      (data.relatedType === "conversation" ||
        data.conversationId ||
        data.conversation_id))
  ) {
    const id = firstId(
      data.conversationId,
      data.conversation_id,
      data.relatedId,
    );
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "conversations", id, fallback: "/messages" };
  }
  if (
    [
      "friend_request",
      "friend_request_accepted",
      "friend_request_declined",
      "new_follower",
      "profile_view",
    ].includes(type)
  ) {
    const id = firstId(data.fromUserId, data.from_user_id, data.relatedId);
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "public_profiles", id, fallback: "/community" };
  }
  if (["post_like", "post_comment", "post_share", "mention"].includes(type)) {
    const id = firstId(data.postId, data.post_id, data.relatedId);
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "posts", id, fallback: "/home" };
  }
  if (
    [
      "event_cancelled",
      "event_invite",
      "event_reminder",
      "event_updated",
    ].includes(type)
  ) {
    if (
      type === "event_cancelled" &&
      !data.eventId &&
      !data.event_id &&
      (data.ticketId || data.ticket_id)
    )
      return null;
    const id = firstId(data.eventId, data.event_id, data.relatedId);
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "events", id, fallback: "/events" };
  }
  if (["catalog_item_inquiry", "catalog_item_out_of_stock"].includes(type)) {
    const id = firstId(data.itemId, data.item_id, data.relatedId);
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "catalog_items", id, fallback: "/businesses" };
  }
  if (["marketplace_item_sold", "marketplace_item_interest"].includes(type)) {
    const id = firstId(data.itemId, data.item_id, data.relatedId);
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "posts", id, fallback: "/marketplace" };
  }
  if (type === "business_review_received") {
    const id = firstId(data.businessId, data.business_id);
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "businesses", id, fallback: "/businesses" };
  }
  if (type.startsWith("booking_") || type === "appeal_decided") {
    const id = firstId(
      data.bookingId,
      data.booking_id,
      type === "appeal_decided" ? undefined : data.relatedId,
    );
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "bookings", id, fallback: "/bookings" };
  }
  if (
    [
      "payment_successful",
      "payment_refunded",
      "item_shipped",
      "delivery_confirmed",
      "funds_released",
    ].includes(type)
  ) {
    const id = firstId(data.transactionId, data.transaction_id, data.relatedId);
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "escrow_transactions", id, fallback: "/transactions" };
  }
  if (type.startsWith("dispute_")) {
    const id = firstId(data.disputeId, data.dispute_id, data.relatedId);
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "disputes", id, fallback: "/disputes" };
  }
  if (
    ["ticket", "ticket_purchase", "ticket_confirmed", "event_rsvp"].includes(
      type,
    )
  ) {
    const ticketId = firstId(data.ticketId, data.ticket_id);
    return ticketId
      ? { table: "tickets", id: ticketId, fallback: "/my-tickets" }
      : null;
  }
  if (type === "safety_alert" || type === "alert") {
    const id = firstId(data.alertId, data.alert_id, data.relatedId, data.id);
    if (!id) return data.url ? getNotificationTarget({ url: data.url }) : null;
    return { table: "alerts", id, fallback: "/alerts" };
  }
  if (typeof data.url === "string") {
    try {
      const url = new URL(data.url, "https://app.yrdly.ng");
      if (url.origin !== "https://app.yrdly.ng") return null;
      if (
        ["/profile/payout-settings", "/settings/payout-settings"].includes(
          url.pathname,
        )
      )
        return null;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "profile" && parts[1] === "payouts") {
        return parts[2]
          ? {
              table: "payout_requests",
              id: decodeURIComponent(parts[2]),
              fallback: "/profile/payouts",
            }
          : null;
      }
      const types: Record<string, string> = {
        messages: "message",
        chat: "message",
        posts: "post_like",
        profile: "profile_view",
        events: "event_updated",
        marketplace: "marketplace_item_interest",
        bookings: "booking_confirmed",
        transactions: "payment_successful",
        disputes: "dispute_opened",
        alerts: "alert",
        alert: "alert",
        communities: "community_update",
      };
      if (parts[0] === "businesses" && parts[1]) {
        if (parts[2] === "catalog" && parts[3])
          return getNotificationTarget({
            type: "catalog_item_inquiry",
            businessId: parts[1],
            itemId: parts[3],
          });
        return getNotificationTarget({
          type: "business_review_received",
          businessId: parts[1],
        });
      }
      if (types[parts[0]] && parts[1])
        return getNotificationTarget({
          type: types[parts[0]],
          relatedId:
            parts[0] === "messages" && parts[1] === "marketplace"
              ? parts[2]
              : parts[1],
          postId:
            parts[0] === "communities" && parts[2] === "posts"
              ? parts[3]
              : undefined,
        });
    } catch {
      /* Invalid URLs have no target. */
    }
  }
  return null;
}

/** Only existing, same-origin app destinations may be opened by a push. */
export function getPushNotificationDestination(
  input: Record<string, any>,
): string {
  const data = normalizeNotificationPayload(input);
  const typed = getNotificationDestination({
    type: String(data.type || ""),
    data,
  });
  if (getNotificationTarget({ ...data, url: undefined })) return typed;
  if (["payout_processed", "payout_failed"].includes(data.type)) return typed;
  if (typeof data.url !== "string") return typed;
  try {
    const url = new URL(data.url, "https://app.yrdly.ng");
    if (url.origin !== "https://app.yrdly.ng") return typed;
    for (const key of [
      "notificationId",
      "recipientId",
      "notificationTarget",
      "targetUnavailable",
    ])
      url.searchParams.delete(key);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const list = [
      "/home",
      "/messages",
      "/community",
      "/events",
      "/events/team",
      "/my-tickets",
      "/businesses",
      "/bookings",
      "/marketplace",
      "/transactions",
      "/disputes",
      "/alerts",
      "/communities",
      "/notifications",
      "/profile/payout-settings",
      "/profile/payouts",
    ];
    if (
      /^\/profile\/payouts\/[^/]+$/.test(path) ||
      /^\/messages\/marketplace\/[^/]+$/.test(path) ||
      /^\/businesses\/[^/]+(?:\/catalog\/[^/]+)?\/chat$/.test(path) ||
      list.includes(path) ||
      /^\/(?:messages|posts|profile|events|businesses|bookings|marketplace|transactions|disputes|alerts|communities)\/[^/]+$/.test(
        path,
      ) ||
      /^\/communities\/[^/]+\/posts\/[^/]+$/.test(path) ||
      /^\/businesses\/[^/]+\/catalog\/[^/]+$/.test(path)
    )
      return path + url.search;
  } catch {
    /* Fall back to a known app route. */
  }
  return typed;
}

/** Lookup uses the signed-in client's RLS policies; inaccessible and deleted targets share a fallback. */
export async function resolveNotificationNavigation(
  input: Record<string, any>,
  lookup: (
    table: string,
    id: string,
  ) => Promise<{ found: boolean; error?: unknown }>,
): Promise<{ destination: string; unavailable: boolean; failed: boolean }> {
  const destination = getPushNotificationDestination(input);
  const target = getNotificationTarget(input);
  if (!target) return { destination, unavailable: false, failed: false };
  let succeeded = false;
  let uncertain = false;
  for (const table of target.table === "alerts"
    ? ["alerts", "safety_alerts"]
    : [target.table]) {
    try {
      const result = await lookup(table, target.id);
      const code = (result.error as { code?: string } | undefined)?.code;
      if (!result.error || ["42P01", "PGRST205", "42501"].includes(code || ""))
        succeeded = true;
      else uncertain = true;
      if (!result.error && result.found)
        return { destination, unavailable: false, failed: false };
    } catch {
      uncertain = true;
    }
  }
  if (succeeded && !uncertain && target.table === "community_posts") {
    const communityId = target.fallback.split("/")[2];
    try {
      const parent = await lookup("communities", communityId);
      if (parent.error)
        return { destination, unavailable: false, failed: true };
      if (!parent.found)
        return {
          destination: "/communities",
          unavailable: true,
          failed: false,
        };
    } catch {
      return { destination, unavailable: false, failed: true };
    }
  }
  return succeeded && !uncertain
    ? { destination: target.fallback, unavailable: true, failed: false }
    : { destination, unavailable: false, failed: true };
}
