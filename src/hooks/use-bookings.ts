import { useState, useEffect, useCallback } from 'react';
import { BookingService, TimeSlot } from '../lib/booking-service';
import {
  ServiceOffering,
  ProviderAvailability,
  AvailabilityException,
  Booking,
} from '../types';

export function useServiceOfferings(businessId?: string) {
  const [offerings, setOfferings] = useState<ServiceOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOfferings = useCallback(async () => {
    if (!businessId) {
      setOfferings([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await BookingService.getServiceOfferings(businessId);
      setOfferings(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch services');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchOfferings();
  }, [fetchOfferings]);

  return { offerings, loading, error, refresh: fetchOfferings };
}

export function useProviderAvailability(businessId?: string) {
  const [availability, setAvailability] = useState<ProviderAvailability[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [weekly, exc] = await Promise.all([
        BookingService.getProviderAvailability(businessId),
        BookingService.getAvailabilityExceptions(businessId),
      ]);
      setAvailability(weekly);
      setExceptions(exc);
    } catch (err) {
      console.error('Error fetching availability:', err);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { availability, exceptions, loading, refresh: fetchData };
}

export function useAvailableSlots(businessId?: string, serviceId?: string, dateString?: string) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSlots = useCallback(async () => {
    if (!businessId || !serviceId || !dateString) {
      setSlots([]);
      return;
    }
    try {
      setLoading(true);
      const data = await BookingService.getAvailableSlots(businessId, serviceId, dateString);
      setSlots(data);
    } catch (err) {
      console.error('Error fetching slots:', err);
    } finally {
      setLoading(false);
    }
  }, [businessId, serviceId, dateString]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  return { slots, loading, refresh: fetchSlots };
}

export function useCustomerBookings(customerId?: string) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBookings = useCallback(async () => {
    if (!customerId) {
      setBookings([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await BookingService.getCustomerBookings(customerId);
      setBookings(data);
    } catch (err) {
      console.error('Error fetching customer bookings:', err);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  return { bookings, loading, refresh: fetchBookings };
}

export function useBusinessBookings(businessId?: string) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBookings = useCallback(async () => {
    if (!businessId) {
      setBookings([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await BookingService.getBusinessBookings(businessId);
      setBookings(data);
    } catch (err) {
      console.error('Error fetching business bookings:', err);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  return { bookings, loading, refresh: fetchBookings };
}
