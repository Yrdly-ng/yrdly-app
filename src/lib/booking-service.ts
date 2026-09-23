import { supabase } from './supabase';
import {
  ServiceOffering,
  ProviderAvailability,
  AvailabilityException,
  Booking,
  StrikeType,
  StrikeParty,
} from '../types';

export const NO_SHOW_FLAG_THRESHOLD = 3;
export const CANCELLATION_WINDOW_HOURS = 5;

export interface TimeSlot {
  time: string; // ISO string
  formattedTime: string; // e.g. "09:00 AM"
  available: boolean;
}

export class BookingService {
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
   * Get weekly availability for a business
   */
  static async getProviderAvailability(businessId: string): Promise<ProviderAvailability[]> {
    const { data, error } = await supabase
      .from('provider_availability')
      .select('*')
      .eq('business_id', businessId)
      .order('day_of_week', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Set or update weekly availability
   */
  static async setProviderAvailability(
    businessId: string,
    schedules: Array<{ day_of_week: number; start_time: string; end_time: string; is_available: boolean }>
  ): Promise<void> {
    for (const schedule of schedules) {
      const { error } = await supabase
        .from('provider_availability')
        .upsert(
          {
            business_id: businessId,
            day_of_week: schedule.day_of_week,
            start_time: schedule.start_time,
            end_time: schedule.end_time,
            is_available: schedule.is_available,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'business_id,day_of_week' }
        );

      if (error) throw error;
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
    const { data, error } = await supabase
      .from('availability_exceptions')
      .upsert(exception, { onConflict: 'business_id,date' })
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Compute available time slots for a specific date and service
   */
  static async getAvailableSlots(
    businessId: string,
    serviceId: string,
    dateString: string // YYYY-MM-DD
  ): Promise<TimeSlot[]> {
    const targetDate = new Date(dateString + 'T00:00:00');
    const dayOfWeek = targetDate.getDay();

    // 1. Fetch service info
    const { data: service, error: serviceError } = await supabase
      .from('service_offerings')
      .select('duration_minutes')
      .eq('id', serviceId)
      .single();

    if (serviceError || !service) return [];
    const durationMs = service.duration_minutes * 60 * 1000;

    // 2. Check for blackout or custom hours on date
    const { data: exception } = await supabase
      .from('availability_exceptions')
      .select('*')
      .eq('business_id', businessId)
      .eq('date', dateString)
      .single();

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
      const { data: weekly } = await supabase
        .from('provider_availability')
        .select('*')
        .eq('business_id', businessId)
        .eq('day_of_week', dayOfWeek)
        .single();

      if (!weekly || !weekly.is_available) {
        return []; // Closed on this day
      }
      startTimeStr = weekly.start_time;
      endTimeStr = weekly.end_time;
    }

    // 4. Fetch existing non-cancelled bookings for date
    const dayStartISO = new Date(`${dateString}T00:00:00`).toISOString();
    const dayEndISO = new Date(`${dateString}T23:59:59`).toISOString();

    const { data: existingBookings } = await supabase
      .from('bookings')
      .select('appointment_time, end_time')
      .eq('business_id', businessId)
      .not('status', 'in', '("cancelled","late_cancelled")')
      .gte('appointment_time', dayStartISO)
      .lte('appointment_time', dayEndISO);

    const bookedIntervals = (existingBookings || []).map((b) => ({
      start: new Date(b.appointment_time).getTime(),
      end: new Date(b.end_time).getTime(),
    }));

    // 5. Generate time slots (30-min steps)
    const slots: TimeSlot[] = [];
    const [startH, startM] = startTimeStr.split(':').map(Number);
    const [endH, endM] = endTimeStr.split(':').map(Number);

    const periodStart = new Date(targetDate);
    periodStart.setHours(startH, startM, 0, 0);

    const periodEnd = new Date(targetDate);
    periodEnd.setHours(endH, endM, 0, 0);

    const stepMs = 30 * 60 * 1000;
    const nowMs = Date.now();

    let curr = periodStart.getTime();
    while (curr + durationMs <= periodEnd.getTime()) {
      const slotEnd = curr + durationMs;

      const isOverlap = bookedIntervals.some(
        (b) => curr < b.end && slotEnd > b.start
      );

      const isPast = curr <= nowMs;
      const available = !isOverlap && !isPast;

      const dateObj = new Date(curr);
      const formattedTime = dateObj.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
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
  }): Promise<Booking> {
    const { data: service } = await supabase
      .from('service_offerings')
      .select('duration_minutes')
      .eq('id', params.serviceId)
      .single();

    const durationMinutes = service?.duration_minutes || 60;
    const startTimeDate = new Date(params.appointmentTime);
    const endTimeDate = new Date(startTimeDate.getTime() + durationMinutes * 60 * 1000);

    const { data, error } = await supabase
      .from('bookings')
      .insert([
        {
          customer_id: params.customerId,
          business_id: params.businessId,
          service_id: params.serviceId,
          appointment_time: params.appointmentTime,
          end_time: endTimeDate.toISOString(),
          notes: params.notes,
          status: 'requested',
        },
      ])
      .select('*, service:service_offerings(*), business:businesses(*)')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Confirm booking request (Provider action)
   */
  static async confirmBooking(bookingId: string): Promise<Booking> {
    const { data, error } = await supabase
      .from('bookings')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .select('*, service:service_offerings(*), business:businesses(*), customer:users(*)')
      .single();

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
    const tableName = party === 'customer' ? 'users' : 'businesses';

    const { data: target } = await supabase
      .from(tableName)
      .select('no_show_count, late_cancellation_count')
      .eq('id', targetId)
      .single();

    if (!target) return;

    let newNoShow = target.no_show_count || 0;
    let newLateCancel = target.late_cancellation_count || 0;

    if (type === 'no_show') newNoShow += 1;
    if (type === 'late_cancellation') newLateCancel += 1;

    const totalStrikes = newNoShow + newLateCancel;
    const isFlagged = totalStrikes >= NO_SHOW_FLAG_THRESHOLD;

    await supabase
      .from(tableName)
      .update({
        no_show_count: newNoShow,
        late_cancellation_count: newLateCancel,
        is_flagged: isFlagged,
      })
      .eq('id', targetId);
  }

  /**
   * Evaluate trailing 90-day active strikes & auto-clear flag if clean for 90 days
   */
  static async evaluateActiveFlagStatus(
    targetId: string,
    party: StrikeParty
  ): Promise<boolean> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const idField = party === 'customer' ? 'customer_id' : 'business_id';

    // 1. Active late cancellations within trailing 90 days (cancelled_at >= 90d ago)
    const { count: lateCancelCount } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq(idField, targetId)
      .eq('status', 'late_cancelled')
      .gte('cancelled_at', ninetyDaysAgo);

    // 2. Active no-shows within trailing 90 days (appointment_time >= 90d ago)
    const { count: noShowCount } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq(idField, targetId)
      .eq('status', 'no_show')
      .gte('appointment_time', ninetyDaysAgo);

    const activeStrikes = (lateCancelCount || 0) + (noShowCount || 0);
    const isFlagged = activeStrikes >= NO_SHOW_FLAG_THRESHOLD;
    const tableName = party === 'customer' ? 'users' : 'businesses';

    await supabase
      .from(tableName)
      .update({ is_flagged: isFlagged })
      .eq('id', targetId);

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
      .select('*, service:service_offerings(*), business:businesses(*), customer:users(*)')
      .eq('business_id', businessId)
      .order('appointment_time', { ascending: false });

    if (error) throw error;
    return data || [];
  }
}

