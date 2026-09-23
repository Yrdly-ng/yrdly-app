'use me';
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { BookingService, CANCELLATION_WINDOW_HOURS } from '@/lib/booking-service';
import { NotificationTriggers } from '@/lib/notification-triggers';
import { supabase } from '@/lib/supabase';
import { Booking } from '@/types';

export default function BookingDetailWebPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const bookingId = params.bookingId as string;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchBooking = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('bookings')
        .select('*, service:service_offerings(*), business:businesses(*), customer:users(*)')
        .eq('id', bookingId)
        .single();

      if (error) throw error;
      setBooking(data);
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to load booking details', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (bookingId) fetchBooking();
  }, [bookingId]);

  if (loading || !booking) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <p className="text-neutral-400">Loading booking details...</p>
      </div>
    );
  }

  const isCustomer = user?.id === booking.customer_id;
  const isProvider = user?.id === booking.business?.owner_id;

  const apptTime = new Date(booking.appointment_time);
  const nowMs = Date.now();
  const hoursUntil = (apptTime.getTime() - nowMs) / (1000 * 60 * 60);
  const isPast = apptTime.getTime() < nowMs;

  const userName = (user as any)?.name || (user as any)?.user_metadata?.full_name || 'User';

  const handleConfirm = async () => {
    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.confirmBooking(booking.id);
      if (booking.customer_id && booking.business?.name) {
        await NotificationTriggers.onBookingConfirmed({
          customerId: booking.customer_id,
          businessName: booking.business.name,
          serviceName: booking.service?.name || 'Service',
          appointmentTime: booking.appointment_time,
          bookingId: booking.id,
        });
      }
      setMsg({ text: 'Booking request confirmed successfully', type: 'success' });
      fetchBooking();
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to confirm booking', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDecline = async () => {
    if (!confirm('Are you sure you want to decline this booking request?')) return;
    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.declineBooking(booking.id);
      if (booking.customer_id) {
        await NotificationTriggers.onBookingCancelled({
          targetUserId: booking.customer_id,
          cancellerName: userName,
          serviceName: booking.service?.name || 'Service',
          isLate: false,
          bookingId: booking.id,
        });
      }
      setMsg({ text: 'Booking request declined', type: 'success' });
      fetchBooking();
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to decline booking', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    const isLate = hoursUntil < CANCELLATION_WINDOW_HOURS;
    const warningMsg = isLate
      ? `Warning: This appointment is less than ${CANCELLATION_WINDOW_HOURS} hours away. Cancelling now will record a Late Cancellation strike against your account.`
      : 'Are you sure you want to cancel this booking?';

    if (!confirm(warningMsg)) return;

    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.cancelBooking(booking.id, user!.id);

      const recipientId = isCustomer ? booking.business?.owner_id : booking.customer_id;
      if (recipientId) {
        await NotificationTriggers.onBookingCancelled({
          targetUserId: recipientId,
          cancellerName: userName,
          serviceName: booking.service?.name || 'Service',
          isLate,
          bookingId: booking.id,
        });
      }

      setMsg({
        text: isLate ? 'Booking late-cancelled. A strike was recorded.' : 'Booking cancelled successfully.',
        type: 'success',
      });
      fetchBooking();
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to cancel booking', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleNoShow = async (party: 'customer' | 'provider') => {
    if (!confirm(`Are you sure you want to record a No-Show against the ${party}? A strike will be attributed.`)) return;

    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.markBookingNoShow(booking.id, party);

      const targetUserId = party === 'customer' ? booking.customer_id : booking.business?.owner_id;
      if (targetUserId) {
        await NotificationTriggers.onBookingNoShow({
          targetUserId,
          serviceName: booking.service?.name || 'Service',
          party,
          bookingId: booking.id,
        });
      }

      setMsg({ text: `No-show recorded against ${party}`, type: 'success' });
      fetchBooking();
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to record no-show', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = async () => {
    setActionLoading(true);
    setMsg(null);
    try {
      await BookingService.completeBooking(booking.id);
      setMsg({ text: 'Booking marked as completed!', type: 'success' });
      fetchBooking();
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to complete booking', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 pb-6 border-b border-neutral-800">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100 transition text-sm"
          >
            ← Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-neutral-100">Booking Details</h1>
            <p className="text-xs text-neutral-400">ID: {booking.id}</p>
          </div>
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

        <div className="space-y-6 mt-6">
          {/* Status Banner */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                Appointment Status
              </span>
              <h2 className="text-2xl font-extrabold text-emerald-400 mt-1 uppercase">
                {booking.status.replace('_', ' ')}
              </h2>
            </div>
            <div className="text-left sm:text-right">
              <span className="text-xs text-neutral-400">Scheduled Time</span>
              <p className="text-sm font-bold text-neutral-100 mt-0.5">
                {apptTime.toLocaleString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
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
                  This customer has accumulated {booking.customer.no_show_count || 0} no-shows and {booking.customer.late_cancellation_count || 0} late cancellations.
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
                  This service provider has accumulated previous late cancellations or no-shows.
                </p>
              </div>
            </div>
          )}

          {/* Service & Party Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Service Info</h3>
              <p className="text-lg font-bold text-neutral-100">{booking.service?.name}</p>
              {booking.service?.description && (
                <p className="text-xs text-neutral-400">{booking.service.description}</p>
              )}
              <div className="flex items-center gap-3 pt-2 text-xs">
                <span className="bg-neutral-950 px-2.5 py-1 rounded-md border border-neutral-800">
                  ⏱ {booking.service?.duration_minutes} mins
                </span>
                {booking.service?.price !== undefined && (
                  <span className="bg-neutral-950 px-2.5 py-1 rounded-md border border-neutral-800 text-emerald-400 font-bold">
                    {booking.service.price_is_from ? 'From ' : ''}₦{booking.service.price.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Parties</h3>
              <div>
                <span className="text-xs text-neutral-400">Business: </span>
                <span className="text-sm font-semibold text-neutral-100">{booking.business?.name}</span>
              </div>
              <div>
                <span className="text-xs text-neutral-400">Customer: </span>
                <span className="text-sm font-semibold text-neutral-100">
                  {booking.customer?.name || 'Customer'}
                </span>
              </div>
              {booking.notes && (
                <div className="pt-2 border-t border-neutral-800/60">
                  <span className="text-xs text-neutral-400 italic">Notes: "{booking.notes}"</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 flex flex-wrap gap-3">
            {isProvider && booking.status === 'requested' && (
              <>
                <button
                  onClick={handleDecline}
                  disabled={actionLoading}
                  className="flex-1 py-3 px-4 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 font-semibold rounded-xl text-sm transition"
                >
                  Decline Request
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={actionLoading}
                  className="flex-1 py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl text-sm transition shadow-lg shadow-emerald-500/10"
                >
                  Confirm Booking
                </button>
              </>
            )}

            {['requested', 'confirmed'].includes(booking.status) && (
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="py-3 px-5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold rounded-xl text-sm transition"
              >
                Cancel Booking
              </button>
            )}

            {booking.status === 'confirmed' && isPast && isProvider && (
              <>
                <button
                  onClick={() => handleNoShow('customer')}
                  disabled={actionLoading}
                  className="py-3 px-5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold rounded-xl text-sm transition"
                >
                  Record Customer No-Show
                </button>
                <button
                  onClick={handleComplete}
                  disabled={actionLoading}
                  className="flex-1 py-3 px-5 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl text-sm transition shadow-lg shadow-emerald-500/10"
                >
                  Mark Complete
                </button>
              </>
            )}

            {booking.status === 'confirmed' && isPast && isCustomer && (
              <button
                onClick={() => handleNoShow('provider')}
                disabled={actionLoading}
                className="py-3 px-5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold rounded-xl text-sm transition"
              >
                Record Provider No-Show
              </button>
            )}
          </div>

          {/* Review Gating: Only visible on completed bookings for customers */}
          {booking.status === 'completed' && isCustomer && (
            <div className="mt-8 bg-neutral-900 border border-emerald-500/20 rounded-2xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-neutral-100">Leave a Review</h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    Your booking is completed! Share your experience with {booking.business?.name}.
                  </p>
                </div>
                <button
                  onClick={() => router.push(`/businesses/${booking.business_id}?review_booking_id=${booking.id}`)}
                  className="py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl text-xs transition"
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

