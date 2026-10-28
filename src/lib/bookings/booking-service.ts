import { authenticatedFetch } from '../auth/authenticated-fetch';
import { supabase } from '../supabase/supabase';
import {
  ServiceOffering,
  ProviderAvailability,
  AvailabilityException,
  Booking,
  StrikeType,
  StrikeParty,
} from '../../types/index';

export const NO_SHOW_FLAG_THRESHOLD = 3;
export const CANCELLATION_WINDOW_HOURS = 5;

export interface TimeSlot {
  time: string; // ISO string
  formattedTime: string; // e.g. "09:00 AM"
  available: boolean;
}

export interface BookingRescheduleRequest {
  id: string;
  booking_id: string;
  requested_by: string;
  appointment_time: string;
  end_time: string;
  original_appointment_time: string;
  original_end_time: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string;
  responded_at: string | null;
}

export class BookingService {
  static async getRescheduleRequest(bookingId: string): Promise<BookingRescheduleRequest | null> {
    const { data, error } = await supabase.from('booking_reschedule_requests').select('*')
      .eq('booking_id', bookingId).eq('status', 'pending').maybeSingle();
    if (error) throw error;
    return data;
  }

  static async requestReschedule(bookingId: string, appointmentTime: string): Promise<BookingRescheduleRequest> {
    const { data, error } = await supabase.rpc('request_booking_reschedule', {
      p_booking_id: bookingId, p_appointment_time: appointmentTime,
    });
    if (error) throw error;
    return data;
  }

  static async respondToReschedule(requestId: string, action: 'accept' | 'reject' | 'withdraw'): Promise<BookingRescheduleRequest> {
    const { data, error } = await supabase.rpc('respond_booking_reschedule', {
      p_request_id: requestId, p_action: action,
    });
    if (error) throw error;
    return data;
  }

  /**
   * Fetch active service offerings for a business
   */
  static async getServiceOfferings(businessId: string): Promise<ServiceOffering[]> {
    const { data, error } = await supabase
      .from('service_offerings')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Create a new service offering
   */
  static async createServiceOffering(
    offering: Omit<ServiceOffering, 'id' | 'created_at' | 'updated_at'>
  ): Promise<ServiceOffering> {
    const { data, error } = await supabase
      .from('service_offerings')
      .insert([offering])
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update service offering
   */
  static async updateServiceOffering(
    id: string,
    updates: Partial<ServiceOffering>
  ): Promise<ServiceOffering> {
    const { data, error } = await supabase
      .from('service_offerings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Delete / deactivate service offering
   */
  static async deleteServiceOffering(id: string): Promise<void> {
    const { error } = await supabase
      .from('service_offerings')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
  }

  /**
   * Get weekly availability for a business (optionally per staff)
   */
  static async getProviderAvailability(businessId: string, staffId?: string | null): Promise<ProviderAvailability[]> {
    let q = supabase.from('provider_availability').select('*').eq('business_id', businessId).order('day_of_week', { ascending: true });
    if (staffId) q = (q as any).eq('staff_id', staffId);
    else if (staffId === null) q = (q as any).is('staff_id', null);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  /**
   * Set or update weekly availability (supports per-staff)
   */
  static async setProviderAvailability(
    businessId: string,
    schedules: Array<{ day_of_week: number; start_time: string; end_time: string; is_available: boolean }>,
    staffId?: string | null
  ): Promise<void> {
    for (const schedule of schedules) {
      const row: any = {
        business_id: businessId,
        day_of_week: schedule.day_of_week,
        start_time: schedule.start_time,
        end_time: schedule.end_time,
        is_available: schedule.is_available,
        updated_at: new Date().toISOString(),
      };
      if (staffId) row.staff_id = staffId;

      // These calendars use partial unique indexes for legacy (NULL staff_id)
      // and staff-specific rows. PostgREST cannot infer those indexes from a
      // plain onConflict column list, so resolve the row and update/insert it.
      let existingQuery: any = supabase.from('provider_availability')
        .select('id')
        .eq('business_id', businessId)
        .eq('day_of_week', schedule.day_of_week);
      existingQuery = staffId
        ? existingQuery.eq('staff_id', staffId)
        : existingQuery.is('staff_id', null);
      const { data: existing, error: lookupError } = await existingQuery.maybeSingle();
      if (lookupError) throw lookupError;

      const result = existing
        ? await supabase.from('provider_availability').update(row).eq('id', existing.id)
        : await supabase.from('provider_availability').insert(row);
      if (result.error) throw result.error;
    }
  }

  /**
   * Get availability exceptions for a business
   */
  static async getAvailabilityExceptions(
    businessId: string,
    startDate?: string,
    endDate?: string
  ): Promise<AvailabilityException[]> {
    let query = supabase
      .from('availability_exceptions')
      .select('*')
      .eq('business_id', businessId);

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Add or update blackout date / custom hours exception
   */
  static async setAvailabilityException(
    exception: Omit<AvailabilityException, 'id' | 'created_at'>
  ): Promise<AvailabilityException> {
    const { data, error } = await supabase.rpc('set_booking_availability_exception', {
      p_business_id: exception.business_id,
      p_date: exception.date,
      p_is_blackout: exception.is_blackout,
      p_staff_id: exception.staff_id || null,
      p_custom_start_time: exception.custom_start_time || null,
      p_custom_end_time: exception.custom_end_time || null,
      p_reason: exception.reason || null,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Compute available time slots for a specific date and service (optional staff filter)
   */
  static async getAvailableSlots(
    businessId: string,
    serviceId: string,
    dateString: string, // YYYY-MM-DD
    staffId?: string | null,
    excludeBookingId?: string
  ): Promise<TimeSlot[]> {
    // Business schedules are Nigerian local time, independent of the visitor's device.
    const dayOfWeek = new Date(dateString + 'T12:00:00Z').getUTCDay();

    // 1. Fetch service info
    const { data: service, error: serviceError } = await supabase
      .from('service_offerings')
      .select('duration_minutes')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .eq('id', serviceId)
      .single();

    if (serviceError) throw serviceError;
    if (!service || !Number.isInteger(service.duration_minutes) || service.duration_minutes <= 0) return [];
    const durationMs = service.duration_minutes * 60 * 1000;

    // 2. Check for blackout or custom hours on date
    let excQ: any = supabase.from('availability_exceptions').select('*').eq('business_id', businessId).eq('date', dateString);
    excQ = staffId ? excQ.eq('staff_id', staffId) : excQ.is('staff_id', null);
    const { data: exception, error: exceptionError } = await excQ.maybeSingle();
    if (exceptionError) throw exceptionError;

    if (exception && exception.is_blackout) {
      return []; // Fully blackout
    }

    // 3. Get standard weekly availability for day of week
    let startTimeStr = '09:00';
    let endTimeStr = '17:00';

    if (exception && exception.custom_start_time && exception.custom_end_time) {
      startTimeStr = exception.custom_start_time;
      endTimeStr = exception.custom_end_time;
    } else {
      let wq: any = supabase.from('provider_availability').select('*').eq('business_id', businessId).eq('day_of_week', dayOfWeek);
      wq = staffId ? wq.eq('staff_id', staffId) : wq.is('staff_id', null);
      const { data: weekly, error: weeklyError } = await wq.maybeSingle();
      if (weeklyError) throw weeklyError;

      if (!weekly || !weekly.is_available) {
        return []; // Closed on this day
      }
      startTimeStr = weekly.start_time;
      endTimeStr = weekly.end_time;
    }

    const { data: existingBookings, error: bookingsError } = await supabase.rpc('booking_busy_intervals', {
      p_business_id: businessId,
      p_date: dateString,
      p_staff_id: staffId || null,
      p_exclude_booking_id: excludeBookingId || null,
    });
    if (bookingsError) throw bookingsError;

    const bookedIntervals = (existingBookings || []).map((b: any) => ({
      start: new Date(b.appointment_time).getTime(),
      end: new Date(b.end_time).getTime(),
    }));

    // 5. Generate time slots (30-min steps)
    const slots: TimeSlot[] = [];
    const periodStart = new Date(`${dateString}T${startTimeStr}+01:00`);
    const periodEnd = new Date(`${dateString}T${endTimeStr}+01:00`);

    const stepMs = 30 * 60 * 1000;
    const nowMs = Date.now();

    let curr = periodStart.getTime();
    while (curr + durationMs <= periodEnd.getTime()) {
      const slotEnd = curr + durationMs;

      const isOverlap = bookedIntervals.some(
        (b: any) => curr < b.end && slotEnd > b.start
      );

      const isPast = curr <= nowMs;
      const available = !isOverlap && !isPast;

      const dateObj = new Date(curr);
      const formattedTime = dateObj.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Africa/Lagos',
      });

      slots.push({
        time: dateObj.toISOString(),
        formattedTime,
        available,
      });

      curr += stepMs;
    }

    return slots;
  }

  /**
   * Create a new booking request
   */
  static async createBookingRequest(params: {
    customerId: string;
    businessId: string;
    serviceId: string;
    appointmentTime: string; // ISO string
    notes?: string;
    staffId?: string | null;
    quoteId?: string | null;
  }): Promise<Booking> {
    const { data } = await authenticatedFetch('/api/bookings/create', params);
    return data;
  }

  /**
   * Confirm booking request (Provider action)
   */
  static async confirmBooking(bookingId: string): Promise<Booking> {
    const { data, error } = await supabase.rpc('accept_service_booking', { p_booking_id: bookingId });
    if (error) throw error;
    return data;
  }

  /**
   * Decline booking request (Provider action)
   */
  static async declineBooking(bookingId: string): Promise<Booking> {
    const { data, error } = await supabase
      .from('bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Cancel booking (Customer or Provider action)
   * Enforces 5-hour cutoff rule for late cancellation & strike recording
   */
  static async cancelBooking(bookingId: string, cancelledByUserId: string): Promise<Booking> {
    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('*, business:businesses(owner_id)')
      .eq('id', bookingId)
      .single();

    if (fetchErr || !booking) throw new Error('Booking not found');

    if (['deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released'].includes(booking.payment_status)) {
      throw new Error('Paid bookings need support-assisted cancellation so the Payluk escrow and refund can be resolved.');
    }

    const appointmentTimeMs = new Date(booking.appointment_time).getTime();
    const nowMs = Date.now();
    const hoursUntilAppointment = (appointmentTimeMs - nowMs) / (1000 * 60 * 60);

    const isLateCancellation = hoursUntilAppointment < CANCELLATION_WINDOW_HOURS;
    const isCustomer = cancelledByUserId === booking.customer_id;
    const strikeParty: StrikeParty = isCustomer ? 'customer' : 'provider';

    const updates: Partial<Booking> = {
      cancelled_by: cancelledByUserId,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (isLateCancellation) {
      updates.status = 'late_cancelled';
      updates.strike_type = 'late_cancellation';
      updates.strike_party = strikeParty;
    } else {
      updates.status = 'cancelled';
    }

    const { data: updatedBooking, error: updateErr } = await supabase
      .from('bookings')
      .update(updates)
      .eq('id', bookingId)
      .select('*, service:service_offerings(*), business:businesses(*)')
      .single();

    if (updateErr) throw updateErr;

    if (isLateCancellation) {
      await this.recordStrikeAndUpdateFlag(
        strikeParty === 'customer' ? booking.customer_id : booking.business_id,
        strikeParty,
        'late_cancellation'
      );
    }

    return updatedBooking;
  }

  /**
   * Mark booking as No-Show
   */
  static async markBookingNoShow(
    bookingId: string,
    targetParty: StrikeParty
  ): Promise<Booking> {
    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchErr || !booking) throw new Error('Booking not found');

    const { data: updatedBooking, error: updateErr } = await supabase
      .from('bookings')
      .update({
        status: 'no_show',
        strike_type: 'no_show',
        strike_party: targetParty,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select('*, service:service_offerings(*), business:businesses(*)')
      .single();

    if (updateErr) throw updateErr;

    const targetId = targetParty === 'customer' ? booking.customer_id : booking.business_id;
    await this.recordStrikeAndUpdateFlag(targetId, targetParty, 'no_show');

    return updatedBooking;
  }

  /**
   * Mark booking as Completed
   */
  static async completeBooking(bookingId: string): Promise<Booking> {
    const { data, error } = await supabase
      .from('bookings')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .select('*, service:service_offerings(*), business:businesses(*)')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Record strike count & update is_flagged status if >= NO_SHOW_FLAG_THRESHOLD
   */
  private static async recordStrikeAndUpdateFlag(
    targetId: string,
    party: StrikeParty,
    type: StrikeType
  ): Promise<void> {
    await this.evaluateActiveFlagStatus(targetId,party);
  }

  static async evaluateActiveFlagStatus(targetId:string,party:StrikeParty): Promise<boolean> {
    const { isFlagged } = await authenticatedFetch('/api/bookings/flags',{ targetId,party });
    return isFlagged;
  }

  /**
   * Check if a completed booking is eligible for review by a customer
   */
  static async canReviewBooking(
    bookingId: string,
    userId: string
  ): Promise<{ canReview: boolean; reason?: string }> {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('customer_id, status')
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return { canReview: false, reason: 'Booking not found.' };
    }

    if (booking.customer_id !== userId) {
      return { canReview: false, reason: 'Only the customer who made this booking can submit a review.' };
    }

    if (booking.status !== 'completed') {
      return { canReview: false, reason: 'Reviews can only be submitted for completed bookings.' };
    }

    // Check if a review already exists for this booking
    const { data: existingReview } = await supabase
      .from('reviews')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (existingReview) {
      return { canReview: false, reason: 'You have already submitted a review for this booking.' };
    }

    return { canReview: true };
  }

  /**
   * Fetch user's bookings (as customer)
   */
  static async getCustomerBookings(customerId: string): Promise<Booking[]> {
    const { data, error } = await supabase
      .from('bookings')
      .select('*, service:service_offerings(*), business:businesses(*)')
      .eq('customer_id', customerId)
      .order('appointment_time', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Fetch business's bookings (as provider)
   */
  static async getBusinessBookings(businessId: string): Promise<Booking[]> {
    const { data, error } = await supabase
      .from('bookings')
      .select('*, service:service_offerings(*), business:businesses(*), customer:public_profiles!bookings_customer_id_fkey(*)')
      .eq('business_id', businessId)
      .order('appointment_time', { ascending: false });

    if (error) throw error;
    return data || [];
  }
}
