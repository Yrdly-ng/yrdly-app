"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useProviderAvailability } from "@/hooks/use-bookings";
import { BookingService } from "@/lib/bookings/booking-service";
import { supabase } from "@/lib/supabase/supabase";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default function ManageAvailabilityWebPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = params.businessId as string;

  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<any[]>([]);
  useEffect(() => {
    if (!businessId) return;
    void (supabase
      .from("business_staff")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at")
      .then(({ data }: any) => {
        if (data) setStaffList(data);
      }) as unknown as Promise<void>);
  }, [businessId]);
  const { availability, exceptions, loading, error, refresh } =
    useProviderAvailability(businessId, selectedStaffId);

  const [schedule, setSchedule] = useState<
    Array<{
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_available: boolean;
    }>
  >([]);

  const [blackoutDate, setBlackoutDate] = useState("");
  const [blackoutReason, setBlackoutReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    const initial = DAYS.map((_, idx) => {
      const existing = availability.find((a) => a.day_of_week === idx);
      return {
        day_of_week: idx,
        start_time: existing?.start_time?.slice(0, 5) || "09:00",
        end_time: existing?.end_time?.slice(0, 5) || "17:00",
        is_available: existing ? existing.is_available : idx >= 1 && idx <= 5,
      };
    });
    setSchedule(initial);
  }, [availability]);

  const handleToggleDay = (dayIdx: number, val: boolean) => {
    setSchedule((prev) =>
      prev.map((d) =>
        d.day_of_week === dayIdx ? { ...d, is_available: val } : d,
      ),
    );
  };

  const handleTimeChange = (
    dayIdx: number,
    field: "start_time" | "end_time",
    val: string,
  ) => {
    setSchedule((prev) =>
      prev.map((d) => (d.day_of_week === dayIdx ? { ...d, [field]: val } : d)),
    );
  };

  const handleSaveSchedule = async () => {
    if (loading || saving || error || schedule.length !== 7) return;
    const invalidDay = schedule.find(
      (day) =>
        day.is_available &&
        (!/^([01]\d|2[0-3]):[0-5]\d$/.test(day.start_time) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.end_time) ||
          day.end_time <= day.start_time),
    );
    if (invalidDay)
      return setMsg({
        text: `${DAYS[invalidDay.day_of_week]} needs valid opening and closing times, with closing after opening.`,
        type: "error",
      });
    setSaving(true);
    setMsg(null);
    try {
      await BookingService.setProviderAvailability(
        businessId,
        schedule,
        selectedStaffId,
      );
      setMsg({
        text: "Weekly working hours saved successfully",
        type: "success",
      });
      refresh();
    } catch (err: any) {
      setMsg({ text: err.message || "Failed to save schedule", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddBlackout = async (e: React.FormEvent) => {
    e.preventDefault();
    const day = blackoutDate.trim();
    const parsed = new Date(`${day}T12:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== day
    ) {
      return setMsg({
        text: "Please enter date in YYYY-MM-DD format (e.g. 2026-12-25)",
        type: "error",
      });
    }

    setSaving(true);
    setMsg(null);
    try {
      await BookingService.setAvailabilityException({
        business_id: businessId,
        date: blackoutDate.trim(),
        staff_id: selectedStaffId,
        is_blackout: true,
        reason: blackoutReason.trim() || "Holiday / Unavailable",
      });
      setBlackoutDate("");
      setBlackoutReason("");
      setMsg({ text: "Day off added successfully", type: "success" });
      refresh();
    } catch (err: any) {
      setMsg({ text: err.message || "Failed to add day off", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen font-yrdly-body bg-background text-foreground p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-7 border-b border-border">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg bg-card border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition"
            >
              ← Back
            </button>
            <div>
              <h1 className="font-yrdly-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                Your working week
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Set your booking hours, then make room for days off.
              </p>
            </div>
          </div>
          <button
            onClick={handleSaveSchedule}
            disabled={saving}
            className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl text-sm transition shadow-lg shadow-none disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Schedule"}
          </button>
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

        {error ? (
          <div
            role="alert"
            className="my-6 rounded-3xl border border-destructive/30 p-5"
          >
            {error}
            <button
              onClick={() => void refresh()}
              className="ml-3 font-semibold underline"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="py-20 text-center text-muted-foreground">
            Loading schedule...
          </div>
        ) : (
          <div className="space-y-8 mt-6">
            {/* Weekly Schedule */}
            <div>
              {staffList.length > 0 && (
                <div className="mb-4 flex items-center gap-2">
                  <label className="text-xs font-bold text-muted-foreground">
                    Staff calendar:
                  </label>
                  <select
                    value={selectedStaffId || ""}
                    onChange={(e) => setSelectedStaffId(e.target.value || null)}
                    className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">Business hours (legacy)</option>
                    {staffList.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.role ? ` — ${s.role}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <h2 className="font-yrdly-display text-xl font-bold text-foreground mb-1">
                Weekly Operating Schedule
                {selectedStaffId ? " — selected staff" : ""}
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Set operating start and end times for each day of the week.{" "}
                {selectedStaffId
                  ? "These hours apply to the selected team member."
                  : "These are the default hours for your business."}
              </p>

              <div className="space-y-3">
                {schedule.map((day) => (
                  <div
                    key={day.day_of_week}
                    className="flex flex-col sm:flex-row sm:items-center justify-between bg-card border border-border rounded-xl p-4 gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={day.is_available}
                        onChange={(e) =>
                          handleToggleDay(day.day_of_week, e.target.checked)
                        }
                        className="w-5 h-5 rounded accent-emerald-500 bg-background border-border cursor-pointer"
                      />
                      <span className="font-semibold text-foreground w-24">
                        {DAYS[day.day_of_week]}
                      </span>
                    </div>

                    {day.is_available ? (
                      <div className="flex items-center gap-2 text-sm leading-relaxed text-muted-foreground">
                        <input
                          type="time"
                          value={day.start_time}
                          onChange={(e) =>
                            handleTimeChange(
                              day.day_of_week,
                              "start_time",
                              e.target.value,
                            )
                          }
                          className="bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-primary"
                        />
                        <span>to</span>
                        <input
                          type="time"
                          value={day.end_time}
                          onChange={(e) =>
                            handleTimeChange(
                              day.day_of_week,
                              "end_time",
                              e.target.value,
                            )
                          }
                          className="bg-background border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-primary"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground font-medium italic">
                        Closed
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Days off */}
            <div className="pt-6 border-t border-border">
              <h2 className="font-yrdly-display text-xl font-bold text-foreground mb-1">
                Days off & Holidays
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Block specific calendar dates from customer booking
              </p>

              <form
                onSubmit={handleAddBlackout}
                className="bg-card border border-border rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3"
              >
                <input
                  type="date"
                  required
                  value={blackoutDate}
                  onChange={(e) => setBlackoutDate(e.target.value)}
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                />
                <input
                  type="text"
                  placeholder="Reason (e.g. Public Holiday)"
                  value={blackoutReason}
                  onChange={(e) => setBlackoutReason(e.target.value)}
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg text-sm transition"
                >
                  + Add Blackout Date
                </button>
              </form>

              <div className="space-y-2">
                {exceptions.map((exc) => (
                  <div
                    key={exc.id}
                    className="flex items-center justify-between bg-card/60 border border-border rounded-xl p-3 text-sm"
                  >
                    <div>
                      <span className="font-semibold text-foreground">
                        {exc.date}
                      </span>
                      {exc.reason && (
                        <span className="text-muted-foreground text-xs ml-2">
                          — {exc.reason}
                        </span>
                      )}
                    </div>
                    <span className="px-2.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-semibold rounded-md">
                      Closed
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
