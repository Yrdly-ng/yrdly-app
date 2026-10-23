"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import {
  BookingService,
  CANCELLATION_WINDOW_HOURS,
} from "@/lib/bookings/booking-service";
import { NotificationTriggers } from "@/lib/notifications/notification-triggers";
import { supabase } from "@/lib/supabase/supabase";
import { Booking } from "@/types";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";

interface BookingCheckout {
  transactionId: string;
  reference: string;
  paylukPaymentToken: string;
  buyerPaylukId: string;
  amount: number;
  commission: number;
  totalAmount: number;
  alreadyPaid?: boolean;
}

export default function BookingDetailWebPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const bookingId = params.bookingId as string;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [msg, setMsg] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [checkoutReview, setCheckoutReview] = useState<BookingCheckout | null>(
    null,
  );

  const fetchBooking = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("bookings")
        .select(
          "*, service:service_offerings(*), business:businesses(*), customer:public_profiles!bookings_customer_id_fkey(*)",
        )
        .eq("id", bookingId)
        .single();

      if (error) throw error;
      setBooking(data);
    } catch (err: any) {
      setMsg({
        text: err.message || "Failed to load booking details",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    if (bookingId) fetchBooking();
  }, [bookingId, fetchBooking]);

  if (loading) {
    return (
      <div className="min-h-screen font-yrdly-body bg-background text-foreground flex items-center justify-center p-4">
        <p className="text-muted-foreground">Loading booking details...</p>
      </div>
    );
  }
  if (!booking)
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6 font-yrdly-body">
        <h1 className="font-yrdly-display text-3xl font-bold">
          Booking details
        </h1>
        <p role="alert">{msg?.text || "Booking not found."}</p>
        <div className="flex gap-3">
          <button
            onClick={() => void fetchBooking()}
            className="rounded-xl bg-primary px-5 py-3 text-primary-foreground"
          >
            Try again
          </button>
          <button
            onClick={() => router.push("/bookings")}
            className="rounded-xl border border-border px-5 py-3"
          >
            Your bookings
          </button>
        </div>
      </div>
    );

  const isCustomer = user?.id === booking.customer_id;
  const isProvider = user?.id === booking.business?.owner_id;

  const apptTime = new Date(booking.appointment_time);
  const nowMs = Date.now();
  const hoursUntil = (apptTime.getTime() - nowMs) / (1000 * 60 * 60);
  const isPast = apptTime.getTime() < nowMs;

  const userName =
    (user as any)?.name || (user as any)?.user_metadata?.full_name || "User";

  const handleConfirm = async () => {
    if (!isProvider || actionLoading) return;
    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.confirmBooking(booking.id);
      if (booking.customer_id && booking.business?.name) {
        await NotificationTriggers.onBookingConfirmed({
          customerId: booking.customer_id,
          businessName: booking.business.name,
          serviceName: booking.service?.name || "Service",
          appointmentTime: booking.appointment_time,
          bookingId: booking.id,
        });
      }
      setMsg({
        text: "Booking request confirmed successfully",
        type: "success",
      });
      fetchBooking();
    } catch (err: any) {
      setMsg({
        text: err.message || "Failed to confirm booking",
        type: "error",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDecline = async () => {
    if (!isProvider || actionLoading) return;
    if (!confirm("Are you sure you want to decline this booking request?"))
      return;
    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.declineBooking(booking.id);
      if (booking.customer_id) {
        await NotificationTriggers.onBookingCancelled({
          targetUserId: booking.customer_id,
          cancellerName: userName,
          serviceName: booking.service?.name || "Service",
          isLate: false,
          bookingId: booking.id,
        });
      }
      setMsg({ text: "Booking request declined", type: "success" });
      fetchBooking();
    } catch (err: any) {
      setMsg({
        text: err.message || "Failed to decline booking",
        type: "error",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if ((!isCustomer && !isProvider) || actionLoading) return;
    const isLate = hoursUntil < CANCELLATION_WINDOW_HOURS;
    const warningMsg = isLate
      ? `Warning: This appointment is less than ${CANCELLATION_WINDOW_HOURS} hours away. Cancelling now will record a Late Cancellation strike against your account.`
      : "Are you sure you want to cancel this booking?";

    if (!confirm(warningMsg)) return;

    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.cancelBooking(booking.id, user!.id);

      const recipientId = isCustomer
        ? booking.business?.owner_id
        : booking.customer_id;
      if (recipientId) {
        await NotificationTriggers.onBookingCancelled({
          targetUserId: recipientId,
          cancellerName: userName,
          serviceName: booking.service?.name || "Service",
          isLate,
          bookingId: booking.id,
        });
      }

      setMsg({
        text: isLate
          ? "Booking late-cancelled. A strike was recorded."
          : "Booking cancelled successfully.",
        type: "success",
      });
      fetchBooking();
    } catch (err: any) {
      setMsg({
        text: err.message || "Failed to cancel booking",
        type: "error",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleNoShow = async (party: "customer" | "provider") => {
    if (
      !confirm(
        `Are you sure you want to record a No-Show against the ${party}? A strike will be attributed.`,
      )
    )
      return;

    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.markBookingNoShow(booking.id, party);

      const targetUserId =
        party === "customer" ? booking.customer_id : booking.business?.owner_id;
      if (targetUserId) {
        await NotificationTriggers.onBookingNoShow({
          targetUserId,
          serviceName: booking.service?.name || "Service",
          party,
          bookingId: booking.id,
        });
      }

      setMsg({ text: `No-show recorded against ${party}`, type: "success" });
      fetchBooking();
    } catch (err: any) {
      setMsg({
        text: err.message || "Failed to record no-show",
        type: "error",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = async () => {
    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.completeBooking(booking.id);
      setMsg({ text: "Booking marked as completed!", type: "success" });
      fetchBooking();
    } catch (err: any) {
      setMsg({
        text: err.message || "Failed to complete booking",
        type: "error",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckout = async () => {
    setActionLoading(true);
    setMsg(null);
    try {
      const result = await authenticatedFetch<BookingCheckout>(
        "/api/bookings/checkout",
        { bookingId: booking.id },
      );
      if (result.alreadyPaid) {
        setMsg({ text: "Your booking payment is confirmed.", type: "success" });
        await fetchBooking();
      } else {
        if (!result.paylukPaymentToken)
          throw new Error("Could not prepare secure checkout.");
        setCheckoutReview(result);
      }
    } catch (error) {
      setMsg({
        text:
          error instanceof Error ? error.message : "Could not start checkout.",
        type: "error",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const openCheckout = async () => {
    if (!checkoutReview) return;
    setActionLoading(true);
    setMsg(null);
    let confirmed = false;
    const verify = async () => {
      await authenticatedFetch("/api/bookings/verify", {
        bookingId: booking.id,
      });
      confirmed = true;
      setCheckoutReview(null);
      setMsg({
        text: "Booking payment confirmed. Your funds are held securely until receipt is confirmed.",
        type: "success",
      });
      await fetchBooking();
    };
    try {
      const publicKey = process.env.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY;
      if (!publicKey)
        throw new Error(
          "Payment checkout is unavailable. Please contact support.",
        );
      const { initEscrowCheckout, pay } =
        await import("payluk-escrow-inline-checkout");
      initEscrowCheckout({ publicKey });
      await pay({
        paymentToken: checkoutReview.paylukPaymentToken,
        reference: checkoutReview.reference,
        customerId: checkoutReview.buyerPaylukId,
        redirectUrl: `${window.location.origin}/bookings/${booking.id}`,
        brand: "Yrdly",
        callback: async () => {
          try {
            await verify();
          } catch {
            setMsg({
              text: "Payment is being verified. Check this booking before paying again.",
              type: "error",
            });
          } finally {
            setActionLoading(false);
          }
        },
        onClose: async () => {
          if (confirmed) return;
          try {
            await verify();
          } catch {
            try {
              await authenticatedFetch("/api/bookings/cancel-checkout", {
                transactionId: checkoutReview.transactionId,
              });
              setCheckoutReview(null);
              setMsg({ text: "Unpaid checkout cancelled.", type: "success" });
              await fetchBooking();
            } catch {
              setMsg({
                text: "Checkout is processing. Check this booking before paying again.",
                type: "error",
              });
            }
          } finally {
            setActionLoading(false);
          }
        },
      });
    } catch (error) {
      setMsg({
        text:
          error instanceof Error ? error.message : "Could not open checkout.",
        type: "error",
      });
      setActionLoading(false);
    }
  };

  const handleReceipt = async () => {
    if (
      !confirm(
        "Confirm that you received the booked service? This releases the payment to the provider.",
      )
    )
      return;
    setActionLoading(true);
    try {
      const payment = await authenticatedFetch<{ transactionId: string }>(
        "/api/bookings/verify",
        { bookingId: booking.id },
      );
      await authenticatedFetch("/api/payluk/confirm-delivery", {
        transactionId: payment.transactionId,
      });
      setMsg({
        text: "Service receipt confirmed. Payment released to the provider.",
        type: "success",
      });
      await fetchBooking();
    } catch (error) {
      setMsg({
        text:
          error instanceof Error
            ? error.message
            : "Could not confirm service receipt.",
        type: "error",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const cancelReviewedCheckout = async () => {
    if (!checkoutReview) return;
    setActionLoading(true);
    try {
      await authenticatedFetch("/api/bookings/cancel-checkout", {
        transactionId: checkoutReview.transactionId,
      });
      setCheckoutReview(null);
      setMsg({ text: "Unpaid checkout cancelled.", type: "success" });
      await fetchBooking();
    } catch (error) {
      setMsg({
        text:
          error instanceof Error ? error.message : "Could not cancel checkout.",
        type: "error",
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen font-yrdly-body bg-background text-foreground p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 pb-6 border-b border-border">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg bg-card border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition text-sm"
          >
            ← Back
          </button>
          <div>
            <h1 className="font-yrdly-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Booking Details
            </h1>
            <p className="text-xs text-muted-foreground">ID: {booking.id}</p>
          </div>
        </div>

        {msg && (
          <div
            className={`my-4 p-3 rounded-xl border text-xs font-medium ${
              msg.type === "success"
                ? "bg-primary/10 border-primary/20 text-primary"
                : "bg-red-500/10 border-red-500/20 text-red-400"
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="space-y-6 mt-6">
          {/* Status Banner */}
          <div className="bg-card border border-border rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Appointment Status
              </span>
              <h2 className="text-2xl font-extrabold text-primary mt-1 uppercase">
                {booking.status.replace("_", " ")}
              </h2>
            </div>
            <div className="text-left sm:text-right">
              <span className="text-xs text-muted-foreground">
                Scheduled Time
              </span>
              <p className="text-sm font-bold text-foreground mt-0.5">
                {apptTime.toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>

          {/* Flag Warning Banners */}
          {isProvider && booking.customer?.is_flagged && (
            <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl text-amber-400 text-xs">
              <span className="text-lg">⚠️</span>
              <div>
                <p className="font-bold">Notice: Customer Flagged</p>
                <p className="text-amber-400/80 mt-0.5">
                  This customer has accumulated{" "}
                  {booking.customer.no_show_count || 0} no-shows and{" "}
                  {booking.customer.late_cancellation_count || 0} late
                  cancellations.
                </p>
              </div>
            </div>
          )}

          {isCustomer && booking.business?.is_flagged && (
            <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl text-amber-400 text-xs">
              <span className="text-lg">⚠️</span>
              <div>
                <p className="font-bold">Notice: Provider Flagged</p>
                <p className="text-amber-400/80 mt-0.5">
                  This service provider has accumulated previous late
                  cancellations or no-shows.
                </p>
              </div>
            </div>
          )}

          {/* Service & Party Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-3xl p-6 space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Service Info
              </h3>
              <p className="font-yrdly-display text-xl font-bold text-foreground">
                {booking.service?.name}
              </p>
              {booking.service?.description && (
                <p className="text-xs text-muted-foreground">
                  {booking.service.description}
                </p>
              )}
              <div className="flex items-center gap-3 pt-2 text-xs">
                <span className="bg-background px-2.5 py-1 rounded-md border border-border">
                  ⏱ {booking.service?.duration_minutes} mins
                </span>
                {booking.service?.price !== undefined && (
                  <span className="bg-background px-2.5 py-1 rounded-md border border-border text-primary font-bold">
                    {booking.service.price_is_from ? "From " : ""}₦
                    {booking.service.price.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            <div className="bg-card border border-border rounded-3xl p-6 space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Parties
              </h3>
              <div>
                <span className="text-xs text-muted-foreground">
                  Business:{" "}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {booking.business?.name}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">
                  Customer:{" "}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {booking.customer?.name || "Customer"}
                </span>
              </div>
              {booking.notes && (
                <div className="pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground italic">
                    Notes: &quot;{booking.notes}&quot;
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          {checkoutReview && (
            <div
              className="rounded-3xl border border-border bg-card p-5 space-y-3"
              aria-label="Booking payment review"
            >
              <h3 className="font-semibold">Review your payment</h3>
              <dl className="text-sm space-y-2">
                <div className="flex justify-between gap-4">
                  <dt>Service payment</dt>
                  <dd>
                    ₦
                    {checkoutReview.amount.toLocaleString("en-NG", {
                      minimumFractionDigits: 2,
                    })}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Yrdly fee (3%)</dt>
                  <dd>
                    ₦
                    {checkoutReview.commission.toLocaleString("en-NG", {
                      minimumFractionDigits: 2,
                    })}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 font-bold">
                  <dt>Total</dt>
                  <dd>
                    ₦
                    {checkoutReview.totalAmount.toLocaleString("en-NG", {
                      minimumFractionDigits: 2,
                    })}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Payluk holds your payment securely. Confirm service receipt here
                to release it to the provider.
              </p>
              <button
                onClick={openCheckout}
                disabled={actionLoading}
                className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
              >
                {actionLoading
                  ? "Opening checkout…"
                  : "Continue to secure checkout"}
              </button>
              <button
                onClick={cancelReviewedCheckout}
                disabled={actionLoading}
                className="w-full rounded-xl border border-border px-4 py-3 text-sm disabled:opacity-50"
              >
                Cancel unpaid checkout
              </button>
            </div>
          )}
          <div className="pt-4 flex flex-wrap gap-3">
            {isCustomer &&
              !checkoutReview &&
              ["requested", "confirmed"].includes(booking.status) &&
              (!!booking.quote_id || !!booking.service?.price) &&
              (!!booking.quote_id ||
                booking.service?.deposit_required ||
                booking.service?.requires_full_payment ||
                booking.service?.escrow_enabled) &&
              ![
                "deposit_paid",
                "fully_paid",
                "escrow_held",
                "escrow_released",
              ].includes(booking.payment_status || "unpaid") && (
                <button
                  onClick={handleCheckout}
                  disabled={actionLoading}
                  className="flex-1 py-3 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl text-sm disabled:opacity-50"
                >
                  {actionLoading
                    ? "Preparing payment…"
                    : "Review booking payment"}
                </button>
              )}
            {isCustomer &&
              ["deposit_paid", "fully_paid", "escrow_held"].includes(
                booking.payment_status || "",
              ) && (
                <button
                  onClick={handleReceipt}
                  disabled={actionLoading}
                  className="flex-1 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
                >
                  Confirm service received
                </button>
              )}
            {isProvider && booking.status === "requested" && (
              <>
                <button
                  onClick={handleDecline}
                  disabled={actionLoading}
                  className="flex-1 py-3 px-4 bg-card border border-border hover:bg-muted text-muted-foreground font-semibold rounded-xl text-sm transition"
                >
                  Decline Request
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={actionLoading}
                  className="flex-1 py-3 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl text-sm transition shadow-lg shadow-none"
                >
                  Confirm Booking
                </button>
              </>
            )}

            {(isCustomer || isProvider) &&
              ["requested", "confirmed"].includes(booking.status) && (
                <button
                  onClick={handleCancel}
                  disabled={actionLoading}
                  className="py-3 px-5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold rounded-xl text-sm transition"
                >
                  Cancel Booking
                </button>
              )}

            {booking.status === "confirmed" && isPast && isProvider && (
              <>
                <button
                  onClick={() => handleNoShow("customer")}
                  disabled={actionLoading}
                  className="py-3 px-5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold rounded-xl text-sm transition"
                >
                  Record Customer No-Show
                </button>
                <button
                  onClick={handleComplete}
                  disabled={actionLoading}
                  className="flex-1 py-3 px-5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl text-sm transition shadow-lg shadow-none"
                >
                  Mark Complete
                </button>
              </>
            )}

            {booking.status === "confirmed" && isPast && isCustomer && (
              <button
                onClick={() => handleNoShow("provider")}
                disabled={actionLoading}
                className="py-3 px-5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold rounded-xl text-sm transition"
              >
                Record Provider No-Show
              </button>
            )}
          </div>

          {/* Review Gating: Only visible on completed bookings for customers */}
          {booking.status === "completed" && isCustomer && (
            <div className="mt-8 bg-card border border-primary/20 rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-yrdly-display text-xl font-bold text-foreground">
                    Leave a Review
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your booking is completed! Share your experience with{" "}
                    {booking.business?.name}.
                  </p>
                </div>
                <button
                  onClick={() =>
                    router.push(
                      `/businesses/${booking.business_id}?review_booking_id=${booking.id}`,
                    )
                  }
                  className="py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl text-xs transition"
                >
                  Write Review
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
