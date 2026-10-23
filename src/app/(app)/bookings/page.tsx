"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useCustomerBookings } from "@/hooks/use-bookings";

export default function BookingsDashboardWebPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");

  const { bookings, loading, error, refresh } = useCustomerBookings(user?.id);

  const filteredBookings = useMemo(() => {
    const now = new Date().getTime();
    if (activeTab === "upcoming") {
      return bookings.filter(
        (b) =>
          ["requested", "confirmed"].includes(b.status) &&
          new Date(b.appointment_time).getTime() >= now - 60 * 60 * 1000,
      );
    } else {
      return bookings.filter(
        (b) =>
          ["completed", "cancelled", "late_cancelled", "no_show"].includes(
            b.status,
          ) || new Date(b.appointment_time).getTime() < now - 60 * 60 * 1000,
      );
    }
  }, [bookings, activeTab]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "requested":
        return {
          label: "Pending Approval",
          cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        };
      case "confirmed":
        return {
          label: "Confirmed",
          cls: "bg-primary/10 text-primary border-primary/20",
        };
      case "completed":
        return {
          label: "Completed",
          cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        };
      case "late_cancelled":
        return {
          label: "Late Cancelled",
          cls: "bg-red-500/10 text-red-400 border-red-500/20",
        };
      case "no_show":
        return {
          label: "No-Show",
          cls: "bg-red-500/10 text-red-400 border-red-500/20",
        };
      case "cancelled":
      default:
        return {
          label: "Cancelled",
          cls: "bg-muted text-muted-foreground border-border",
        };
    }
  };

  return (
    <div className="min-h-screen font-yrdly-body bg-background text-foreground p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-7 border-b border-border">
          <div>
            <h1 className="font-yrdly-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Your appointments
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Keep track of your plans, from the first request to the next
              visit.
            </p>
          </div>
          <button
            onClick={refresh}
            className="p-2 rounded-lg bg-card border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition text-sm"
          >
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-card border border-border p-1 rounded-xl max-w-md my-6">
          <button
            onClick={() => setActiveTab("upcoming")}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
              activeTab === "upcoming"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Coming up
          </button>
          <button
            onClick={() => setActiveTab("past")}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
              activeTab === "past"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Past appointments
          </button>
        </div>

        {/* Content */}
        {error ? (
          <div
            role="alert"
            className="rounded-3xl border border-destructive/30 p-5"
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
            Loading bookings...
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-border rounded-3xl bg-card">
            <p className="text-muted-foreground text-base">
              No {activeTab} bookings found.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredBookings.map((b) => {
              const badge = getStatusBadge(b.status);
              const dateStr = new Date(b.appointment_time).toLocaleString(
                "en-US",
                {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                },
              );

              return (
                <div
                  key={b.id}
                  onClick={() => router.push(`/bookings/${b.id}`)}
                  className="bg-card border border-border rounded-3xl p-6 hover:border-border transition cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {b.business?.name || "Service Provider"}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <h3 className="font-yrdly-display text-xl font-bold text-foreground">
                      {b.service?.name || "Appointment"}
                    </h3>

                    <div className="flex items-center gap-2 mt-3 text-xs font-semibold text-primary">
                      <span>🗓 {dateStr}</span>
                    </div>

                    {b.notes && (
                      <p className="text-xs text-muted-foreground mt-3 font-mono line-clamp-1">
                        Note: {b.notes}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                    <span>View Booking Details</span>
                    <span>→</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
