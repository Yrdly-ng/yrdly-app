type NotificationRouteInput = {
  type: string;
  relatedId?: string | null;
  data?: Record<string, any> | null;
};

const firstId = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === "string" && value.length > 0);

export function getNotificationDestination({ type, relatedId, data }: NotificationRouteInput): string {
  switch (type) {
    case "friend_request":
    case "friend_request_accepted":
    case "friend_request_declined":
    case "new_follower": {
      const profileId = firstId(data?.fromUserId, data?.from_user_id, relatedId);
      return profileId ? `/profile/${profileId}` : "/community";
    }
    case "message":
    case "message_reaction": {
      const conversationId = firstId(data?.conversationId, data?.conversation_id, relatedId);
      return conversationId ? `/messages/${conversationId}` : "/messages";
    }
    case "post_like":
    case "post_comment":
    case "post_share":
    case "mention": {
      const postId = firstId(data?.postId, data?.post_id, relatedId);
      return postId ? `/posts/${postId}` : "/home";
    }
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
      return businessId ? `/businesses/${businessId}?tab=reviews` : "/businesses";
    }
    case "booking_requested":
    case "booking_confirmed":
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
    case "quote_converted":
      return "/bookings";
    case "marketplace_message": {
      const conversationId = firstId(data?.conversationId, data?.conversation_id, relatedId);
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
      const transactionId = firstId(data?.transactionId, data?.transaction_id, relatedId);
      return transactionId ? `/transactions/${transactionId}` : "/transactions";
    }
    case "dispute_opened":
    case "dispute_resolved": {
      const disputeId = firstId(data?.disputeId, data?.dispute_id, relatedId);
      return disputeId ? `/disputes/${disputeId}` : "/disputes";
    }
    case "payout_processed":
    case "payout_failed":
      return "/profile/payout-settings";
    case "safety_alert":
    case "alert": {
      const alertId = firstId(data?.id, data?.alertId, data?.alert_id, relatedId);
      return alertId ? `/alerts/${alertId}` : "/alerts";
    }
    default:
      return "/home";
  }
}
