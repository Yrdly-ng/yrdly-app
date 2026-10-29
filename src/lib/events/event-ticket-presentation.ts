/** Entry presentation follows ticket/refund/event state; the server still authorises every scan. */
export type TicketPresentationInput = {
  status: string;
  refund_status?: string | null;
  amount_paid?: number;
  expires_at?: string | null;
  event?: { status?: string; end_time?: string | null } | null;
};

export function getEventTicketPresentation(
  ticket: TicketPresentationInput,
  now = Date.now(),
) {
  const result = (
    label: string,
    message: string,
    isValid = false,
    isPast = false,
    tone = "muted",
  ) => ({
    label,
    message,
    isValid,
    isPast,
    isExpired: label === "Expired",
    tone,
  });
  if (ticket.status === "REFUNDED" || ticket.refund_status === "processed") {
    return Number(ticket.amount_paid) === 0
      ? result(
          "Cancelled",
          "This free ticket has been cancelled and cannot be used for entry.",
          false,
          true,
        )
      : result(
          "Refunded",
          "The payment provider has confirmed this refund. If it has not reached your account, contact the organiser or YRDLY support.",
          false,
          true,
        );
  }
  if (ticket.refund_status) {
    return ["failed", "needs-attention", "review"].includes(
      ticket.refund_status,
    )
      ? result(
          "Refund needs support",
          "This refund needs review. Entry remains blocked. Contact the organiser or YRDLY support before making another payment.",
          false,
          false,
          "warning",
        )
      : result(
          "Refund pending",
          "Your refund is being processed. This ticket cannot be used for entry. Refresh to check its status.",
          false,
          false,
          "warning",
        );
  }
  if (ticket.status === "USED")
    return result(
      "Used",
      "This ticket has already been checked in.",
      false,
      true,
    );
  if (ticket.status === "CANCELLED")
    return result(
      "Cancelled",
      "This ticket has been cancelled and cannot be used for entry.",
      false,
      true,
    );
  if (ticket.event?.status === "CANCELLED")
    return result(
      "Event cancelled",
      "This event has been cancelled. Contact the organiser about your ticket and any refund.",
      false,
      true,
    );
  if (ticket.event?.status === "COMPLETED")
    return result(
      "Event ended",
      "This event has ended. This ticket is kept here for your records.",
      false,
      true,
    );
  if (
    ticket.status !== "PAID" ||
    !ticket.event ||
    ticket.event.status !== "PUBLISHED"
  ) {
    return result(
      "Unavailable",
      "Entry is unavailable. Refresh the ticket or contact the organiser for help.",
    );
  }
  const dates = [ticket.expires_at, ticket.event.end_time].filter(
    (value): value is string => !!value,
  );
  if (!dates.length || dates.some((value) => !Number.isFinite(Date.parse(value)))) {
    return result(
      "Unavailable",
      "The ticket dates could not be confirmed. Contact the organiser for help.",
    );
  }
  if (dates.some((value) => Date.parse(value) <= now)) {
    return result(
      "Expired",
      "This ticket has expired and cannot be used for entry.",
      false,
      true,
    );
  }
  return result(
    "Active",
    "Present this QR code to the door team for check-in.",
    true,
    false,
    "success",
  );
}
