"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useAvailableSlots } from "@/hooks/use-bookings";
import { BookingService } from "@/lib/bookings/booking-service";
import { NotificationTriggers } from "@/lib/notifications/notification-triggers";
import { supabase } from "@/lib/supabase/supabase";

export default function CreateBookingWebPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  const businessId = searchParams.get("businessId") as string;
  const serviceId = searchParams.get("serviceId") as string;

  const dates = useMemo(() => {
    const list = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      // Keep the calendar date in the visitor's local timezone. toISOString()
      // would turn Lagos midnight into the previous UTC date.
      const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const displayDay = d.toLocaleDateString("en-US", { weekday: "short" });
      const displayNum = d.getDate();
      const displayMonth = d.toLocaleDateString("en-US", { month: "short" });
      list.push({ isoDate, displayDay, displayNum, displayMonth });
    }
    return list;
  }, []);

  const [selectedDate, setSelectedDate] = useState(dates[0].isoDate);
  const [selectedSlotTime, setSelectedSlotTime] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const [service, setService] = useState<any>(null);
  const [business, setBusiness] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [detailsError, setDetailsError] = useState("");
  const [detailsAttempt, setDetailsAttempt] = useState(0);

  const [staffList, setStaffList] = useState<any[]>([]);
  const [serviceStaffIds, setServiceStaffIds] = useState<string[] | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const {
    slots,
    loading: slotsLoading,
    error: slotsError,
    refresh: refreshSlots,
  } = useAvailableSlots(businessId, serviceId, selectedDate, selectedStaffId);

  useEffect(() => {
    if (!businessId) return;
    void (supabase
      .from("business_staff")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("created_at")
      .then(({ data }: any) => {
        if (data) setStaffList(data);
      }) as unknown as Promise<void>);
  }, [businessId]);

  useEffect(() => {
    if (!serviceId) return;
    let active = true;
    void supabase
      .from("service_staff_assignments")
      .select("staff_id")
      .eq("service_id", serviceId)
      .then(({ data, error }: any) => {
        if (!active || error) return;
        setServiceStaffIds(
          data?.length ? data.map((row: any) => row.staff_id) : null,
        );
      });
    return () => {
      active = false;
    };
  }, [serviceId]);

  const eligibleStaff = useMemo(
    () =>
      serviceStaffIds
        ? staffList.filter((staff) => serviceStaffIds.includes(staff.id))
        : staffList,
    [serviceStaffIds, staffList],
  );

  useEffect(() => {
    if (
      serviceStaffIds?.length &&
      !serviceStaffIds.includes(selectedStaffId || "")
    ) {
      setSelectedStaffId(eligibleStaff[0]?.id || null);
      setSelectedSlotTime(null);
    }
  }, [serviceStaffIds, eligibleStaff, selectedStaffId]);

  useEffect(() => {
    let active = true;
    if (!businessId || !serviceId) {
      setLoadingDetails(false);
      setDetailsError(
        "Choose a service from a business page to request an appointment.",
      );
      return;
    }
    const fetchDetails = async () => {
      try {
        setLoadingDetails(true);
        setDetailsError("");
        const [serviceRes, bizRes] = await Promise.all([
          supabase
            .from("service_offerings")
            .select("*")
            .eq("id", serviceId)
            .eq("business_id", businessId)
            .single(),
          supabase
            .from("businesses")
            .select("*")
            .eq("id", businessId)
            .eq("is_active", true)
            .single(),
        ]);
        if (!active) return;
        if (serviceRes.error) throw serviceRes.error;
        if (bizRes.error) throw bizRes.error;
        if (!serviceRes.data || !bizRes.data)
          throw new Error("This service is no longer available.");
        if (serviceRes.data) setService(serviceRes.data);
        if (bizRes.data) setBusiness(bizRes.data);
      } catch (err) {
        if (active)
          setDetailsError("We couldn’t load this service. Please try again.");
      } finally {
        if (active) setLoadingDetails(false);
      }
    };
    void fetchDetails();
    return () => {
      active = false;
    };
  }, [businessId, serviceId, detailsAttempt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      submitting ||
      loadingDetails ||
      detailsError ||
      slotsLoading ||
      slotsError ||
      !selectedSlotTime ||
      !slots.some((slot) => slot.time === selectedSlotTime && slot.available)
    ) {
      return setErrMsg("Please select an available appointment time slot");
    }
    if (!user) {
      return setErrMsg("Please sign in to submit a booking request");
    }

    setSubmitting(true);
    setErrMsg("");
    try {
      const newBooking = await BookingService.createBookingRequest({
        customerId: user.id,
        businessId: businessId,
        serviceId: serviceId,
        appointmentTime: selectedSlotTime,
        notes: notes.trim() || undefined,
        staffId: selectedStaffId,
      });

      const userName =
        (user as any)?.name ||
        (user as any)?.user_metadata?.full_name ||
        "Customer";
      try {
        if (business?.owner_id) {
          await NotificationTriggers.onBookingRequested({
            providerOwnerId: business.owner_id,
            customerName: userName,
            serviceName: service.name,
            appointmentTime: selectedSlotTime,
            bookingId: newBooking.id,
          });
        }
      } catch (notificationError) {
        console.error(
          "Booking saved; notification delivery needs retry",
          notificationError,
        );
      }

      const paymentRequired =
        service.deposit_required ||
        service.requires_full_payment ||
        service.escrow_enabled;
      alert(
        paymentRequired
          ? "Booking requested. Wait for the business to accept your appointment and final price before paying. You can return through My Bookings."
          : "Booking requested. The provider will review and confirm. Find the details anytime in My Bookings.",
      );
      router.push(`/bookings/${newBooking.id}`);
    } catch (err: any) {
      setErrMsg(err.message || "Failed to submit booking request");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingDetails) {
    return (
      <div className="min-h-screen font-yrdly-body bg-background text-foreground flex items-center justify-center p-4">
        <p className="text-muted-foreground">Loading service details...</p>
      </div>
    );
  }

  if (detailsError || !service || !business)
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6 font-yrdly-body">
        <h1 className="font-yrdly-display text-3xl font-bold">
          Request an appointment
        </h1>
        <p role="alert" className="text-muted-foreground">
          {detailsError || "This service is unavailable."}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDetailsAttempt((value) => value + 1)}
            className="rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground"
          >
            Try again
          </button>
          <button
            onClick={() =>
              router.push(
                businessId ? `/businesses/${businessId}` : "/businesses",
              )
            }
            className="rounded-xl border border-border px-5 py-3"
          >
            Browse services
          </button>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen font-yrdly-body bg-background text-foreground p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 pb-6 border-b border-border">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg bg-card border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition"
          >
            ← Back
          </button>
          <div>
            <h1 className="font-yrdly-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Request Appointment
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Select an appointment time for your service
            </p>
          </div>
        </div>

        {errMsg && (
          <div
            role="alert"
            className="my-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium rounded-xl"
          >
            {errMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          {/* Service Summary Card */}
          <div className="bg-card border border-border rounded-3xl p-6">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {business?.name}
            </span>
            <h2 className="font-yrdly-display text-2xl font-bold text-foreground mt-1">
              {service?.name}
            </h2>
            {service?.description && (
              <p className="text-sm leading-relaxed text-muted-foreground mt-2">
                {service.description}
              </p>
            )}
            <div className="flex items-center gap-4 mt-4 text-xs font-medium text-muted-foreground">
              <span className="bg-background px-3 py-1 rounded-lg border border-border">
                ⏱ {service?.duration_minutes} minutes
              </span>
              {service?.price != null && (
                <span className="bg-background px-3 py-1 rounded-lg border border-border text-primary font-bold">
                  {service.price_is_from ? "From " : ""}₦
                  {service.price.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          {/* Provider Flag Warning */}
          {business?.is_flagged && (
            <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl text-amber-400 text-xs">
              <span className="text-lg">⚠️</span>
              <div>
                <p className="font-bold">Notice: High Cancellation Rate</p>
                <p className="text-amber-400/80 mt-0.5">
                  This service provider has accumulated previous late
                  cancellations or no-shows.
                </p>
              </div>
            </div>
          )}

          {/* Date Picker */}
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">
              1. Select Date
            </label>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
              {dates.map((item) => {
                const isSelected = item.isoDate === selectedDate;
                return (
                  <button
                    key={item.isoDate}
                    type="button"
                    onClick={() => {
                      setSelectedDate(item.isoDate);
                      setSelectedSlotTime(null);
                    }}
                    className={`flex-shrink-0 w-20 py-3 rounded-xl border text-center transition ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground font-bold shadow-lg shadow-none"
                        : "bg-card border-border text-muted-foreground hover:border-border"
                    }`}
                  >
                    <div className="text-xs uppercase opacity-80">
                      {item.displayDay}
                    </div>
                    <div className="font-yrdly-display text-xl font-bold my-0.5">
                      {item.displayNum}
                    </div>
                    <div className="text-[10px] uppercase opacity-70">
                      {item.displayMonth}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Slot Picker */}
          <div>
            {eligibleStaff.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-bold text-foreground mb-2">
                  Staff (optional)
                </label>
                <select
                  value={selectedStaffId || ""}
                  onChange={(e) => {
                    setSelectedStaffId(e.target.value || null);
                    setSelectedSlotTime(null);
                  }}
                  className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm text-foreground"
                >
                  {!serviceStaffIds?.length && (
                    <option value="">No specific staff</option>
                  )}
                  {eligibleStaff.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.role ? ` — ${s.role}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label className="block text-sm font-bold text-foreground mb-2">
              2. Select Available Slot
              {selectedStaffId ? " (selected staff)" : ""}
            </label>
            {slotsError ? (
              <div
                role="alert"
                className="rounded-3xl border border-destructive/30 p-4 text-sm"
              >
                {slotsError}
                <button
                  type="button"
                  onClick={() => void refreshSlots()}
                  className="ml-3 font-semibold underline"
                >
                  Try again
                </button>
              </div>
            ) : slotsLoading ? (
              <div className="py-8 text-center text-muted-foreground text-xs">
                Checking availability...
              </div>
            ) : slots.length === 0 ? (
              <div className="p-6 bg-card border border-border rounded-xl text-center text-muted-foreground text-sm">
                No available appointment slots on this date. Please select
                another date.
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {slots.map((slot) => {
                  const isSelected = slot.time === selectedSlotTime;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      disabled={!slot.available}
                      onClick={() => setSelectedSlotTime(slot.time)}
                      className={`py-3 px-2 rounded-xl text-xs font-semibold border transition ${
                        !slot.available
                          ? "bg-muted/50 border-border text-muted-foreground/60 line-through cursor-not-allowed"
                          : isSelected
                            ? "bg-primary border-primary text-primary-foreground font-bold"
                            : "bg-card border-border text-foreground hover:border-border"
                      }`}
                    >
                      {slot.formattedTime}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">
              3. Notes for Provider (Optional)
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any specific requests or instructions for your service appointment..."
              className="w-full bg-card border border-border rounded-xl p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={
              !selectedSlotTime ||
              submitting ||
              slotsLoading ||
              !!slotsError ||
              !slots.some(
                (slot) => slot.time === selectedSlotTime && slot.available,
              )
            }
            className="w-full py-4 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base rounded-xl transition shadow-xl shadow-none disabled:opacity-50"
          >
            {submitting ? "Submitting Request..." : "Submit Booking Request"}
          </button>
        </form>
      </div>
    </div>
  );
}
