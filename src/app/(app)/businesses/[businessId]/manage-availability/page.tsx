'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useProviderAvailability } from '@/hooks/use-bookings';
import { BookingService } from '@/lib/booking-service';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ManageAvailabilityWebPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = params.businessId as string;

  const { availability, exceptions, loading, refresh } = useProviderAvailability(businessId);

  const [schedule, setSchedule] = useState<
    Array<{ day_of_week: number; start_time: string; end_time: string; is_available: boolean }>
  >([]);

  const [blackoutDate, setBlackoutDate] = useState('');
  const [blackoutReason, setBlackoutReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const initial = DAYS.map((_, idx) => {
      const existing = availability.find((a) => a.day_of_week === idx);
      return {
        day_of_week: idx,
        start_time: existing?.start_time || '09:00',
        end_time: existing?.end_time || '17:00',
        is_available: existing ? existing.is_available : idx >= 1 && idx <= 5,
      };
    });
    setSchedule(initial);
  }, [availability]);

  const handleToggleDay = (dayIdx: number, val: boolean) => {
    setSchedule((prev) =>
      prev.map((d) => (d.day_of_week === dayIdx ? { ...d, is_available: val } : d))
    );
  };

  const handleTimeChange = (dayIdx: number, field: 'start_time' | 'end_time', val: string) => {
    setSchedule((prev) =>
      prev.map((d) => (d.day_of_week === dayIdx ? { ...d, [field]: val } : d))
    );
  };

  const handleSaveSchedule = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await BookingService.setProviderAvailability(businessId, schedule);
      setMsg({ text: 'Weekly working hours saved successfully', type: 'success' });
      refresh();
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to save schedule', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddBlackout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blackoutDate.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(blackoutDate.trim())) {
      return setMsg({ text: 'Please enter date in YYYY-MM-DD format (e.g. 2026-12-25)', type: 'error' });
    }

    setSaving(true);
    setMsg(null);
    try {
      await BookingService.setAvailabilityException({
        business_id: businessId,
        date: blackoutDate.trim(),
        is_blackout: true,
        reason: blackoutReason.trim() || 'Holiday / Unavailable',
      });
      setBlackoutDate('');
      setBlackoutReason('');
      setMsg({ text: 'Blackout date added successfully', type: 'success' });
      refresh();
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to add blackout date', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100 transition"
            >
              ← Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-neutral-100">Operating Hours & Schedule</h1>
              <p className="text-sm text-neutral-400">Configure weekly availability and blackout holiday exceptions</p>
            </div>
          </div>
          <button
            onClick={handleSaveSchedule}
            disabled={saving}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold rounded-xl text-sm transition shadow-lg shadow-emerald-500/10 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Schedule'}
          </button>
        </div>

        {msg && (
          <div
            className={`my-4 p-3 rounded-xl border text-xs font-medium ${
              msg.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}
          >
            {msg.text}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-neutral-400">Loading schedule...</div>
        ) : (
          <div className="space-y-8 mt-6">
            {/* Weekly Schedule */}
            <div>
              <h2 className="text-lg font-bold text-neutral-100 mb-1">Weekly Operating Schedule</h2>
              <p className="text-xs text-neutral-400 mb-4">Set operating start and end times for each day of the week</p>

              <div className="space-y-3">
                {schedule.map((day) => (
                  <div
                    key={day.day_of_week}
                    className="flex flex-col sm:flex-row sm:items-center justify-between bg-neutral-900 border border-neutral-800 rounded-xl p-4 gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={day.is_available}
                        onChange={(e) => handleToggleDay(day.day_of_week, e.target.checked)}
                        className="w-5 h-5 rounded accent-emerald-500 bg-neutral-950 border-neutral-800 cursor-pointer"
                      />
                      <span className="font-semibold text-neutral-200 w-24">
                        {DAYS[day.day_of_week]}
                      </span>
                    </div>

                    {day.is_available ? (
                      <div className="flex items-center gap-2 text-sm text-neutral-300">
                        <input
                          type="time"
                          value={day.start_time}
                          onChange={(e) => handleTimeChange(day.day_of_week, 'start_time', e.target.value)}
                          className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500"
                        />
                        <span>to</span>
                        <input
                          type="time"
                          value={day.end_time}
                          onChange={(e) => handleTimeChange(day.day_of_week, 'end_time', e.target.value)}
                          className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-500 font-medium italic">Closed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Blackout Dates */}
            <div className="pt-6 border-t border-neutral-800">
              <h2 className="text-lg font-bold text-neutral-100 mb-1">Blackout Dates & Holidays</h2>
              <p className="text-xs text-neutral-400 mb-4">Block specific calendar dates from customer booking</p>

              <form onSubmit={handleAddBlackout} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="date"
                  required
                  value={blackoutDate}
                  onChange={(e) => setBlackoutDate(e.target.value)}
                  className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  placeholder="Reason (e.g. Public Holiday)"
                  value={blackoutReason}
                  onChange={(e) => setBlackoutReason(e.target.value)}
                  className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold rounded-lg text-sm transition"
                >
                  + Add Blackout Date
                </button>
              </form>

              <div className="space-y-2">
                {exceptions.map((exc) => (
                  <div
                    key={exc.id}
                    className="flex items-center justify-between bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 text-sm"
                  >
                    <div>
                      <span className="font-semibold text-neutral-200">{exc.date}</span>
                      {exc.reason && <span className="text-neutral-400 text-xs ml-2">— {exc.reason}</span>}
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
