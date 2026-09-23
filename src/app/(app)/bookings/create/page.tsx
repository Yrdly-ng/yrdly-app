'use me';
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useAvailableSlots } from '@/hooks/use-bookings';
import { BookingService } from '@/lib/booking-service';
import { NotificationTriggers } from '@/lib/notification-triggers';
import { supabase } from '@/lib/supabase';

export default function CreateBookingWebPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  const businessId = searchParams.get('businessId') as string;
  const serviceId = searchParams.get('serviceId') as string;

  const dates = useMemo(() => {
    const list = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const isoDate = d.toISOString().split('T')[0];
      const displayDay = d.toLocaleDateString('en-US', { weekday: 'short' });
      const displayNum = d.getDate();
      const displayMonth = d.toLocaleDateString('en-US', { month: 'short' });
      list.push({ isoDate, displayDay, displayNum, displayMonth });
    }
    return list;
  }, []);

  const [selectedDate, setSelectedDate] = useState(dates[0].isoDate);
  const [selectedSlotTime, setSelectedSlotTime] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const [service, setService] = useState<any>(null);
  const [business, setBusiness] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);

  const { slots, loading: slotsLoading } = useAvailableSlots(businessId, serviceId, selectedDate);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        setLoadingDetails(true);
        const [serviceRes, bizRes] = await Promise.all([
          supabase.from('service_offerings').select('*').eq('id', serviceId).single(),
          supabase.from('businesses').select('*').eq('id', businessId).single(),
        ]);
        if (serviceRes.data) setService(serviceRes.data);
        if (bizRes.data) setBusiness(bizRes.data);
      } catch (err) {
        console.error('Error fetching details:', err);
      } finally {
        setLoadingDetails(false);
      }
    };
    if (businessId && serviceId) fetchDetails();
  }, [businessId, serviceId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlotTime) {
      return setErrMsg('Please select an available appointment time slot');
    }
    if (!user) {
      return setErrMsg('Please sign in to submit a booking request');
    }

    setSubmitting(true);
    setErrMsg('');
    try {
      const newBooking = await BookingService.createBookingRequest({
        customerId: user.id,
        businessId: businessId,
        serviceId: serviceId,
        appointmentTime: selectedSlotTime,
        notes: notes.trim() || undefined,
      });

      const userName = (user as any)?.name || (user as any)?.user_metadata?.full_name || 'Customer';
      if (business?.owner_id) {
        await NotificationTriggers.onBookingRequested({
          providerOwnerId: business.owner_id,
          customerName: userName,
          serviceName: service.name,
          appointmentTime: selectedSlotTime,
          bookingId: newBooking.id,
        });
      }

      alert('Booking request submitted! The service provider will review and confirm.');
      router.push('/bookings');
    } catch (err: any) {
      setErrMsg(err.message || 'Failed to submit booking request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingDetails) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <p className="text-neutral-400">Loading service details...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 pb-6 border-b border-neutral-800">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100 transition"
          >
            ← Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-neutral-100">Request Appointment</h1>
            <p className="text-sm text-neutral-400">Select an appointment time for your service</p>
          </div>
        </div>

        {errMsg && (
          <div className="my-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium rounded-xl">
            {errMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          {/* Service Summary Card */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              {business?.name}
            </span>
            <h2 className="text-xl font-bold text-neutral-100 mt-1">{service?.name}</h2>
            {service?.description && (
              <p className="text-sm text-neutral-400 mt-2">{service.description}</p>
            )}
            <div className="flex items-center gap-4 mt-4 text-xs font-medium text-neutral-300">
              <span className="bg-neutral-950 px-3 py-1 rounded-lg border border-neutral-800">
                ⏱ {service?.duration_minutes} minutes
              </span>
              {service?.price !== undefined && (
                <span className="bg-neutral-950 px-3 py-1 rounded-lg border border-neutral-800 text-emerald-400 font-bold">
                  {service.price_is_from ? 'From ' : ''}₦{service.price.toLocaleString()}
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
                  This service provider has accumulated previous late cancellations or no-shows.
                </p>
              </div>
            </div>
          )}

          {/* Date Picker */}
          <div>
            <label className="block text-sm font-bold text-neutral-200 mb-2">1. Select Date</label>
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
                        ? 'bg-emerald-500 border-emerald-500 text-neutral-950 font-bold shadow-lg shadow-emerald-500/10'
                        : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                    }`}
                  >
                    <div className="text-xs uppercase opacity-80">{item.displayDay}</div>
                    <div className="text-lg font-bold my-0.5">{item.displayNum}</div>
                    <div className="text-[10px] uppercase opacity-70">{item.displayMonth}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Slot Picker */}
          <div>
            <label className="block text-sm font-bold text-neutral-200 mb-2">2. Select Available Slot</label>
            {slotsLoading ? (
              <div className="py-8 text-center text-neutral-400 text-xs">Checking availability...</div>
            ) : slots.length === 0 ? (
              <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl text-center text-neutral-400 text-sm">
                No available appointment slots on this date. Please select another date.
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
                          ? 'bg-neutral-950/50 border-neutral-900 text-neutral-600 line-through cursor-not-allowed'
                          : isSelected
                          ? 'bg-emerald-500 border-emerald-500 text-neutral-950 font-bold'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-200 hover:border-neutral-700'
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
            <label className="block text-sm font-bold text-neutral-200 mb-2">3. Notes for Provider (Optional)</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any specific requests or instructions for your service appointment..."
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!selectedSlotTime || submitting}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-base rounded-xl transition shadow-xl shadow-emerald-500/10 disabled:opacity-50"
          >
            {submitting ? 'Submitting Request...' : 'Submit Booking Request'}
          </button>
        </form>
      </div>
    </div>
  );
}
