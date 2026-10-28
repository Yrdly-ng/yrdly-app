"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookingService,
  type BookingRescheduleRequest,
  type TimeSlot,
} from "@/lib/bookings/booking-service";
import type { Booking } from "@/types";

function lagosDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
function appointmentLabel(value: string): string {
  return new Date(value).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Date changes retain the original appointment until the other party accepts. */
export function BookingReschedulePanel({
  booking,
  userId,
  onChanged,
}: {
  booking: Booking;
  userId?: string;
  onChanged: () => Promise<void>;
}) {
  const [request, setRequest] = useState<BookingRescheduleRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(lagosDate(new Date()));
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const isParty =
    !!userId &&
    (booking.customer_id === userId || booking.business?.owner_id === userId);
  const paymentLocked = [
    "deposit_pending",
    "deposit_paid",
    "fully_paid",
    "escrow_held",
    "escrow_released",
  ].includes(booking.payment_status || "");
  const canChange =
    isParty &&
    ["requested", "confirmed"].includes(booking.status) &&
    Date.parse(booking.appointment_time) > Date.now();
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRequest(await BookingService.getRescheduleRequest(booking.id));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load date changes.",
      );
    } finally {
      setLoading(false);
    }
  }, [booking.id]);
  useEffect(() => {
    if (isParty && !paymentLocked) void refresh();
  }, [isParty, paymentLocked, refresh]);
  useEffect(() => {
    if (!editing || !canChange || paymentLocked) return;
    let active = true;
    setSlot("");
    setSlots([]);
    setSlotsLoading(true);
    setError(null);
    void BookingService.getAvailableSlots(
      booking.business_id,
      booking.service_id,
      date,
      booking.staff_id ?? null,
      booking.id,
    )
      .then((result) => {
        if (active) setSlots(result);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load times.",
          );
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    editing,
    canChange,
    paymentLocked,
    date,
    booking.id,
    booking.business_id,
    booking.service_id,
    booking.staff_id,
  ]);

  const act = async (action: "request" | "accept" | "reject" | "withdraw") => {
    if (busy || !canChange || paymentLocked) return;
    if (
      action === "request" &&
      (!slot || !slots.some((value) => value.time === slot && value.available))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      if (action === "request")
        await BookingService.requestReschedule(booking.id, slot);
      else if (request)
        await BookingService.respondToReschedule(request.id, action);
      setEditing(false);
      await onChanged();
      await refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update the appointment.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canChange) return null;
  if (paymentLocked)
    return (
      <section
        aria-label="Reschedule booking"
        className="rounded-3xl border border-border bg-card p-5 space-y-3"
      >
        <h3 className="font-semibold">Need a different appointment time?</h3>
        <p className="text-sm text-muted-foreground">
          This booking has a checkout or payment attached. Contact support to
          agree a safe date change with the other party.
        </p>
        <a
          className="inline-block text-sm underline"
          href={`/settings/help?booking_id=${encodeURIComponent(booking.id)}&reason=booking-reschedule`}
        >
          Get booking support
        </a>
      </section>
    );
  const pending = request?.status === "pending";
  const ownRequest = request?.requested_by === userId;
  return (
    <section
      aria-label="Reschedule booking"
      className="rounded-3xl border border-border bg-card p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Change appointment time</h3>
        <button
          onClick={() => void refresh()}
          disabled={loading || busy}
          className="text-sm underline disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Both you and the{" "}
        {booking.customer_id === userId ? "business" : "customer"} must agree.
        Your current appointment stays booked until the new time is accepted.
        Payment and service details stay attached to this booking.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm" role="status">
          Checking date changes…
        </p>
      ) : pending ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">
            Proposed: {appointmentLabel(request.appointment_time)} (Lagos time)
          </p>
          <p className="text-sm text-muted-foreground">
            {ownRequest
              ? "Waiting for the other party to respond."
              : "Review the proposed time before accepting."}
          </p>
          <div className="flex flex-wrap gap-3">
            {ownRequest ? (
              <button
                disabled={busy}
                onClick={() => void act("withdraw")}
                className="rounded-xl border border-border px-4 py-3 text-sm"
              >
                Withdraw request
              </button>
            ) : (
              <>
                <button
                  disabled={busy}
                  onClick={() => void act("accept")}
                  className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
                >
                  Accept new time
                </button>
                <button
                  disabled={busy}
                  onClick={() => void act("reject")}
                  className="rounded-xl border border-border px-4 py-3 text-sm"
                >
                  Keep original time
                </button>
              </>
            )}
          </div>
        </div>
      ) : editing ? (
        <div className="space-y-4">
          <label className="block text-sm">
            New date (Lagos time)
            <input
              type="date"
              min={lagosDate(new Date())}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-2 block min-h-12 rounded-xl border border-border bg-background px-3"
            />
          </label>
          <label className="block text-sm">
            Available time
            <select
              aria-label="New appointment time"
              disabled={slotsLoading}
              value={slot}
              onChange={(event) => setSlot(event.target.value)}
              className="mt-2 block min-h-12 w-full rounded-xl border border-border bg-background px-3"
            >
              <option value="">
                {slotsLoading ? "Loading times…" : "Choose a time"}
              </option>
              {slots
                .filter(
                  (value) =>
                    value.available && value.time !== booking.appointment_time,
                )
                .map((value) => (
                  <option key={value.time} value={value.time}>
                    {value.formattedTime}
                  </option>
                ))}
            </select>
          </label>
          {!slotsLoading && !slots.some((value) => value.available) && (
            <p className="text-sm text-muted-foreground">
              No times available. Choose another date.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy || slotsLoading || !slot}
              onClick={() => void act("request")}
              className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              Propose new time
            </button>
            <button
              disabled={busy}
              onClick={() => setEditing(false)}
              className="rounded-xl border border-border px-4 py-3 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        !error && (
          <button
            onClick={() => setEditing(true)}
            className="rounded-xl border border-border px-4 py-3 text-sm font-semibold"
          >
            Request reschedule
          </button>
        )
      )}
    </section>
  );
}
