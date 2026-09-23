'use me';
'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useCustomerBookings } from '@/hooks/use-bookings';

export default function BookingsDashboardWebPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');

  const { bookings, loading, refresh } = useCustomerBookings(user?.id);

  const filteredBookings = useMemo(() => {
    const now = new Date().getTime();
    if (activeTab === 'upcoming') {
      return bookings.filter(
        (b) =>
          ['requested', 'confirmed'].includes(b.status) &&
          new Date(b.appointment_time).getTime() >= now - 60 * 60 * 1000
      );
    } else {
      return bookings.filter(
        (b) =>
          ['completed', 'cancelled', 'late_cancelled', 'no_show'].includes(b.status) ||
          new Date(b.appointment_time).getTime() < now - 60 * 60 * 1000
      );
    }
  }, [bookings, activeTab]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'requested':
        return { label: 'Pending Approval', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
      case 'confirmed':
        return { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
      case 'completed':
        return { label: 'Completed', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
      case 'late_cancelled':
        return { label: 'Late Cancelled', cls: 'bg-red-500/10 text-red-400 border-red-500/20' };
      case 'no_show':
        return { label: 'No-Show', cls: 'bg-red-500/10 text-red-400 border-red-500/20' };
      case 'cancelled':
      default:
        return { label: 'Cancelled', cls: 'bg-neutral-800 text-neutral-400 border-neutral-700' };
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-neutral-800">
          <div>
            <h1 className="text-2xl font-bold text-neutral-100">My Bookings</h1>
            <p className="text-sm text-neutral-400">Manage your appointment requests and service bookings</p>
          </div>
          <button
            onClick={refresh}
            className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100 transition text-sm"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-neutral-900 border border-neutral-800 p-1 rounded-xl max-w-md my-6">
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
              activeTab === 'upcoming'
                ? 'bg-emerald-500 text-neutral-950 shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Upcoming Bookings
          </button>
          <button
            onClick={() => setActiveTab('past')}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
              activeTab === 'past'
                ? 'bg-emerald-500 text-neutral-950 shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Past & History
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-20 text-center text-neutral-400">Loading bookings...</div>
        ) : filteredBookings.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-neutral-800 rounded-2xl bg-neutral-900/40">
            <p className="text-neutral-400 text-base">No {activeTab} bookings found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredBookings.map((b) => {
              const badge = getStatusBadge(b.status);
              const dateStr = new Date(b.appointment_time).toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={b.id}
                  onClick={() => router.push(`/bookings/${b.id}`)}
                  className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 hover:border-neutral-700 transition cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-neutral-400">
                        {b.business?.name || 'Service Provider'}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>

                    <h3 className="text-lg font-bold text-neutral-100">{b.service?.name || 'Appointment'}</h3>

                    <div className="flex items-center gap-2 mt-3 text-xs font-semibold text-emerald-400">
                      <span>🗓 {dateStr}</span>
                    </div>

                    {b.notes && (
                      <p className="text-xs text-neutral-400 mt-3 font-mono line-clamp-1">
                        Note: {b.notes}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-neutral-800/60 flex items-center justify-between text-xs text-neutral-400">
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
