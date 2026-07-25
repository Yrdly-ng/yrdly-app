"use client";

import { useState, useCallback, useRef } from "react";
import { reverseGeocode, ResolvedLocation, OUTSIDE_NIGERIA } from "@/lib/geocoding-service";

// ── Types ───────────────────────────────────────────────────────

export type GpsStatus =
  | "idle"
  | "requesting"
  | "geocoding"
  | "success"
  | "denied"
  | "unavailable"
  | "timeout"
  | "error"
  | typeof OUTSIDE_NIGERIA;

export interface GpsLocationResult extends ResolvedLocation {
  status: "success";
}

export interface GpsLocationState {
  status: GpsStatus;
  location: ResolvedLocation | null;
  error: string | null;
}

// ── Fallback ──────────────────────────────────────────────────────
export const DEFAULT_BOUNDING_BOX: ResolvedLocation = {
  state: "Lagos",
  lga: "Ikeja",
  ward: "Ikeja",
  displayAddress: "Nigeria", // Use country-level display for fallback
  lat: 9.0820,
  lng: 8.6753, // Centered roughly on Nigeria
};

// ── Hook ────────────────────────────────────────────────────────

export function useGpsLocation() {
  const [state, setState] = useState<GpsLocationState>({
    status: "idle",
    location: null,
    error: null,
  });

  // Prevent double-clicks
  const requesting = useRef(false);

  const detectLocation = useCallback(async () => {
    if (requesting.current) return;
    requesting.current = true;

    // Check browser support
    if (!navigator.geolocation) {
      setState({
        status: "unavailable",
        location: null,
        error: "Your browser doesn't support location detection.",
      });
      requesting.current = false;
      return;
    }

    setState({ status: "requesting", location: null, error: null });

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 60000, // accept cached position up to 1 min old
          });
        },
      );

      const { latitude, longitude } = position.coords;

      setState((prev) => ({ ...prev, status: "geocoding" }));

      const resolved = await reverseGeocode(latitude, longitude);

      if ("status" in resolved && resolved.status === OUTSIDE_NIGERIA) {
        setState({
          status: OUTSIDE_NIGERIA,
          location: null,
          error: null,
        });
        return;
      }

      setState({
        status: "success",
        location: resolved as ResolvedLocation,
        error: null,
      });
    } catch (err: any) {
      // GeolocationPositionError
      if (err?.code === 1) {
        setState({
          status: "denied",
          location: DEFAULT_BOUNDING_BOX,
          error: "Location access was denied. Showing Lagos feed instead.",
        });
      } else if (err?.code === 3) {
        setState({
          status: "timeout",
          location: null,
          error: "Location detection timed out. Please try again or select manually.",
        });
      } else {
        setState({
          status: "error",
          location: null,
          error: "Could not detect your location. Please select manually.",
        });
      }
    } finally {
      requesting.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: "idle", location: null, error: null });
    requesting.current = false;
  }, []);

  return {
    ...state,
    detectLocation,
    reset,
  };
}
