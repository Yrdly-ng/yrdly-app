import { useState, useEffect, useCallback, useRef } from "react";
import { BookingService, TimeSlot } from "../lib/bookings/booking-service";
import {
  ServiceOffering,
  ProviderAvailability,
  AvailabilityException,
  Booking,
} from "../types";

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
      setError(err.message || "Failed to fetch services");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchOfferings();
  }, [fetchOfferings]);

  return { offerings, loading, error, refresh: fetchOfferings };
}

export function useProviderAvailability(
  businessId?: string,
  staffId?: string | null,
) {
  const [availability, setAvailability] = useState<ProviderAvailability[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);

  const fetchData = useCallback(async () => {
    const request = ++revision.current;
    setError(null);
    if (!businessId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);

      const [weekly, exc] = await Promise.all([
        BookingService.getProviderAvailability(businessId, staffId ?? null),
        BookingService.getAvailabilityExceptions(businessId),
      ]);
      if (request !== revision.current) return;
      setAvailability(weekly);
      setExceptions(exc);
    } catch (err) {
      if (request === revision.current)
        setError(
          err instanceof Error
            ? err.message
            : "Could not load this information. Please try again.",
        );
      console.error("Error fetching availability:", err);
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [businessId, staffId]);

  useEffect(() => {
    setAvailability([]);
    setExceptions([]);
    void fetchData();
    return () => {
      revision.current++;
    };
  }, [fetchData]);

  return { availability, exceptions, loading, error, refresh: fetchData };
}

export function useAvailableSlots(
  businessId?: string,
  serviceId?: string,
  dateString?: string,
  staffId?: string | null,
) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);

  const fetchSlots = useCallback(async () => {
    const request = ++revision.current;
    setError(null);
    if (!businessId || !serviceId || !dateString) {
      setSlots([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setSlots([]);
      const data = await BookingService.getAvailableSlots(
        businessId,
        serviceId,
        dateString,
        staffId ?? null,
      );
      if (request === revision.current) setSlots(data);
    } catch (err) {
      if (request === revision.current)
        setError(
          err instanceof Error
            ? err.message
            : "Could not load this information. Please try again.",
        );
      console.error("Error fetching slots:", err);
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [businessId, serviceId, dateString, staffId]);

  useEffect(() => {
    void fetchSlots();
    return () => {
      revision.current++;
    };
  }, [fetchSlots]);

  return { slots, loading, error, refresh: fetchSlots };
}

export function useCustomerBookings(customerId?: string) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);

  const fetchBookings = useCallback(async () => {
    const request = ++revision.current;
    setError(null);
    if (!customerId) {
      setBookings([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);

      const data = await BookingService.getCustomerBookings(customerId);
      if (request === revision.current) setBookings(data);
    } catch (err) {
      if (request === revision.current)
        setError(
          err instanceof Error
            ? err.message
            : "Could not load this information. Please try again.",
        );
      console.error("Error fetching customer bookings:", err);
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    setBookings([]);
    void fetchBookings();
    return () => {
      revision.current++;
    };
  }, [fetchBookings]);

  return { bookings, loading, error, refresh: fetchBookings };
}

export function useBusinessBookings(businessId?: string) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);

  const fetchBookings = useCallback(async () => {
    const request = ++revision.current;
    setError(null);
    if (!businessId) {
      setBookings([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);

      const data = await BookingService.getBusinessBookings(businessId);
      if (request === revision.current) setBookings(data);
    } catch (err) {
      if (request === revision.current)
        setError(
          err instanceof Error
            ? err.message
            : "Could not load this information. Please try again.",
        );
      console.error("Error fetching business bookings:", err);
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    setBookings([]);
    void fetchBookings();
    return () => {
      revision.current++;
    };
  }, [fetchBookings]);

  return { bookings, loading, error, refresh: fetchBookings };
}
