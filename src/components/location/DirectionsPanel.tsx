"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Locate, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase/supabase";
import { coordinates } from "@/lib/location/map-model";
import {
  createDirectionsSession,
  decodeRoutePolyline,
} from "@/lib/location/directions-client";
import type {
  DirectionsDestination,
  DirectionsMode,
  DirectionsPoint,
  DirectionsRoute,
  DirectionsTarget,
} from "@/lib/location/directions-types";
import { DirectionsSummary } from "./DirectionsSummary";

async function requestJson<T>(
  path: string,
  method: "GET" | "POST",
  signal: AbortSignal,
  body?: object,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (signal.aborted) throw new Error("Request cancelled");
  if (!session) throw new Error("Please sign in again to get directions.");
  const response = await fetch(path, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      typeof value.error === "string"
        ? value.error
        : "Directions are unavailable. Please retry.",
    );
  return value;
}

type StartChoice = DirectionsPoint & { label: string };
const action =
  "min-h-11 rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#82DB7E]";

export function DirectionsPanel({
  target,
  currentLocation,
  locating,
  locationError,
  onLocate,
  onClose,
  onDestination,
  onRoute,
}: {
  target: DirectionsTarget;
  currentLocation: DirectionsPoint | null;
  locating: boolean;
  locationError: string;
  onLocate: () => void;
  onClose: () => void;
  onDestination: (destination: DirectionsDestination | null) => void;
  onRoute: (route: DirectionsRoute | null) => void;
}) {
  const [destination, setDestination] = useState<DirectionsDestination | null>(
    null,
  );
  const [destinationError, setDestinationError] = useState("");
  const [destinationRetry, setDestinationRetry] = useState(0);
  const [mode, setMode] = useState<DirectionsMode>("driving");
  const [useDevice, setUseDevice] = useState(true);
  const [address, setAddress] = useState("");
  const [start, setStart] = useState<StartChoice | null>(null);
  const [choices, setChoices] = useState<StartChoice[]>([]);
  const [searching, setSearching] = useState(false);
  const [startError, setStartError] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [route, setRoute] = useState<DirectionsRoute | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [routeRetry, setRouteRetry] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const session = useMemo(
    () =>
      createDirectionsSession((path, body, signal) =>
        requestJson<DirectionsRoute>(path, "POST", signal, body),
      ),
    [],
  );
  const origin = useDevice ? currentLocation : start;

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setDestination(null);
    setDestinationError("");
    onDestination(null);
    const timer = setTimeout(() => {
      controller.abort();
      if (!disposed)
        setDestinationError("Destination lookup timed out. Please retry.");
    }, 15000);
    void requestJson<DirectionsDestination>(
      `/api/directions/destination?${new URLSearchParams({ type: target.type, id: target.id })}`,
      "GET",
      controller.signal,
    )
      .then((value) => {
        if (!disposed && !controller.signal.aborted) {
          setDestination(value);
          onDestination(value);
        }
      })
      .catch((error) => {
        if (!disposed)
          setDestinationError(
            error instanceof Error ? error.message : "Destination unavailable.",
          );
      })
      .finally(() => clearTimeout(timer));
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [target.type, target.id, destinationRetry, onDestination]);

  useEffect(() => {
    let disposed = false;
    setRoute(null);
    onRoute(null);
    setRouteError("");
    setRouting(false);
    if (!destination || !origin) return () => session.cancel();
    setRouting(true);
    void session
      .route({ type: destination.type, id: destination.id }, origin, mode)
      .then((value) => {
        if (disposed || !value) return;
        if (!decodeRoutePolyline(value.overview_polyline).length)
          throw new Error("The route line is unavailable. Please retry.");
        setRoute(value);
        onRoute(value);
      })
      .catch((error) => {
        if (!disposed)
          setRouteError(
            error instanceof Error
              ? error.message
              : "Route unavailable. Please retry.",
          );
      })
      .finally(() => {
        if (!disposed) setRouting(false);
      });
    return () => {
      disposed = true;
      session.cancel();
    };
  }, [destination, origin, mode, routeRetry, onRoute, session]);

  useEffect(() => {
    if (!searchRevision || useDevice || !address.trim()) return;
    let disposed = false;
    const controller = new AbortController();
    setSearching(true);
    setStartError("");
    const timer = setTimeout(() => {
      controller.abort();
      if (!disposed) {
        setSearching(false);
        setStartError("Address search timed out. Please retry.");
      }
    }, 10000);
    void requestJson<{
      status: string;
      results?: {
        formatted_address?: string;
        geometry?: { location?: DirectionsPoint };
      }[];
    }>(
      `/api/maps/geocode/json?address=${encodeURIComponent(address.trim())}`,
      "GET",
      controller.signal,
    )
      .then((value) => {
        if (disposed || controller.signal.aborted) return;
        if (!["OK", "ZERO_RESULTS"].includes(value.status))
          throw new Error("Address search unavailable. Please retry.");
        const found = (value.results || [])
          .flatMap((result) => {
            const point = coordinates(
              result.geometry?.location?.lat,
              result.geometry?.location?.lng,
            );
            return point
              ? [
                  {
                    ...point,
                    label: result.formatted_address || address.trim(),
                  },
                ]
              : [];
          })
          .slice(0, 5);
        setChoices(found);
        if (!found.length)
          setStartError(
            "No starting address found. Include the town and state.",
          );
      })
      .catch((error) => {
        if (!disposed)
          setStartError(
            error instanceof Error
              ? error.message
              : "Address search unavailable.",
          );
      })
      .finally(() => {
        clearTimeout(timer);
        if (!disposed) setSearching(false);
      });
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchRevision, address, useDevice]);

  const close = useCallback(() => {
    session.cancel();
    onRoute(null);
    onDestination(null);
    onClose();
  }, [session, onRoute, onDestination, onClose]);

  return (
    <div className="space-y-4 p-4 text-white">
      <button
        type="button"
        onClick={close}
        className={`${action} flex items-center gap-2`}
      >
        <ArrowLeft size={18} /> Back to map
      </button>
      <h2 className="text-lg font-bold">Get directions</h2>
      {destinationError ? (
        <div role="alert">
          <p>{destinationError}</p>
          <button
            type="button"
            className={`${action} mt-2`}
            onClick={() => setDestinationRetry((value) => value + 1)}
          >
            Retry destination
          </button>
        </div>
      ) : !destination ? (
        <p role="status">Finding destination…</p>
      ) : (
        <div className="flex items-start gap-3">
          {destination.image && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={destination.image}
              alt=""
              onError={() => setImageFailed(true)}
              className="h-14 w-14 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <MapPin className="h-10 w-10 shrink-0 text-[#82DB7E]" />
          )}
          <div>
            <h3 className="font-semibold">{destination.title}</h3>
            <p className="text-sm text-[#C7D5CB]">{destination.address}</p>
            {destination.approximate && (
              <p className="mt-1 text-xs text-amber-100">
                {destination.type === "marketplace"
                  ? "Approximate pickup area"
                  : "Approximate destination"}
              </p>
            )}
          </div>
        </div>
      )}
      <fieldset className="flex gap-2">
        <legend className="mb-2 text-sm font-semibold">Travel mode</legend>
        {(["driving", "walking"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            className={`${action} flex-1 ${mode === value ? "bg-[#82DB7E] text-[#0B0D0B]" : ""}`}
            onClick={() => setMode(value)}
          >
            {value === "driving" ? "Driving" : "Walking"}
          </button>
        ))}
      </fieldset>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Starting point</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={useDevice}
            className={action}
            onClick={() => {
              setUseDevice(true);
              setChoices([]);
              if (!currentLocation) onLocate();
            }}
          >
            Your location
          </button>
          <button
            type="button"
            aria-pressed={!useDevice}
            className={action}
            onClick={() => setUseDevice(false)}
          >
            Another address
          </button>
        </div>
        {useDevice ? (
          <div className="text-sm text-[#C7D5CB]">
            {locating ? (
              <p role="status">Finding your location…</p>
            ) : currentLocation ? (
              <p>{locationError || "Using your current location"}</p>
            ) : (
              <p>
                {locationError ||
                  "Allow location access, or choose another starting address."}
              </p>
            )}
            <button
              type="button"
              disabled={locating}
              onClick={onLocate}
              className={`${action} mt-2 inline-flex items-center gap-2`}
            >
              <Locate size={16} />
              {currentLocation ? "Refresh location" : "Use my location"}
            </button>
          </div>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSearchRevision((value) => value + 1);
            }}
          >
            <label htmlFor="directions-start" className="sr-only">
              Starting address
            </label>
            <input
              id="directions-start"
              value={address}
              maxLength={280}
              placeholder="Street, town and state"
              autoComplete="street-address"
              onChange={(event) => {
                setAddress(event.target.value);
                setStart(null);
                setChoices([]);
                setStartError("");
                setSearching(false);
                setSearchRevision(0);
              }}
              className="min-h-11 w-full rounded-xl border border-white/20 bg-white/10 px-3 text-sm text-white placeholder:text-[#C7D5CB]"
            />
            <button
              type="submit"
              disabled={!address.trim() || searching}
              className={action}
            >
              {searching ? "Finding addresses…" : "Find starting address"}
            </button>
            {startError && (
              <p role="alert" className="text-sm text-amber-100">
                {startError}
              </p>
            )}
            {choices.length > 0 && (
              <ul aria-label="Choose starting address" className="space-y-1">
                {choices.map((choice, index) => (
                  <li key={`${index}-${choice.label}`}>
                    <button
                      type="button"
                      className={`${action} w-full text-left`}
                      onClick={() => {
                        setStart(choice);
                        setChoices([]);
                      }}
                    >
                      {choice.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {start && (
              <p className="text-sm text-[#C7D5CB]">
                Starting from {start.label}
              </p>
            )}
          </form>
        )}
      </div>
      {routing && (
        <p role="status">
          Calculating your {mode === "walking" ? "walking" : "driving"} route…
        </p>
      )}
      {routeError && (
        <div role="alert">
          <p>{routeError}</p>
          <button
            type="button"
            className={`${action} mt-2`}
            onClick={() => setRouteRetry((value) => value + 1)}
          >
            Retry route
          </button>
        </div>
      )}
      {route && <DirectionsSummary route={route} />}
      {destination && (
        <Link
          href={destination.href}
          className={`${action} block text-center text-[#82DB7E]`}
        >
          {destination.type === "marketplace"
            ? "View listing / contact seller"
            : destination.type === "business"
              ? "View business / message owner"
              : "View event"}
        </Link>
      )}
      <p className="text-xs text-[#C7D5CB]">
        Route preview only. Live turn-by-turn and voice navigation are not
        enabled.
      </p>
    </div>
  );
}
