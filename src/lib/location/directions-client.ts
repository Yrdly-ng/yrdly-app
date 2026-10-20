import type {
  DirectionsTarget,
  DirectionsPoint,
  DirectionsMode,
  DirectionsRoute,
} from "./directions-types";

const destinationTypes = new Set([
  "marketplace",
  "event",
  "business",
  "legacy-event",
]);
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);

export function buildDirectionsHref(target: DirectionsTarget): string {
  if (!destinationTypes.has(target.type) || !validId(target.id))
    throw new Error("Invalid destination");
  return `/map?${new URLSearchParams({ destinationType: target.type, destinationId: target.id })}`;
}

export function readDirectionsTarget(
  query: Pick<URLSearchParams, "get" | "getAll">,
): DirectionsTarget | null {
  const type = query.get("destinationType");
  const id = query.get("destinationId");
  return type &&
    destinationTypes.has(type) &&
    validId(id) &&
    query.getAll("destinationType").length === 1 &&
    query.getAll("destinationId").length === 1
    ? { type: type as DirectionsTarget["type"], id }
    : null;
}

export function directionsTargetForMarker(marker: {
  type: string;
  id: string;
  targetId: string;
}): DirectionsTarget | null {
  if (marker.type === "friend") return null;
  const type = marker.id.startsWith("legacy-event-")
    ? "legacy-event"
    : marker.type;
  return destinationTypes.has(type) && validId(marker.targetId)
    ? { type: type as DirectionsTarget["type"], id: marker.targetId }
    : null;
}

export function decodeRoutePolyline(encoded: unknown): DirectionsPoint[] {
  if (typeof encoded !== "string" || !encoded || encoded.length > 200000)
    return [];
  let index = 0,
    lat = 0,
    lng = 0;
  const points: DirectionsPoint[] = [];
  function delta() {
    let value = 0,
      shift = 0,
      chunk: number;
    do {
      if (index >= (encoded as string).length || shift > 30)
        throw new Error("Invalid route line");
      chunk = (encoded as string).charCodeAt(index++) - 63;
      if (chunk < 0 || chunk > 63) throw new Error("Invalid route line");
      value |= (chunk & 31) << shift;
      shift += 5;
    } while (chunk >= 32);
    return value & 1 ? ~(value >>> 1) : value >>> 1;
  }
  try {
    while (index < encoded.length) {
      lat += delta();
      lng += delta();
      const point = { lat: lat / 100000, lng: lng / 100000 };
      if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return [];
      points.push(point);
    }
    return points.length >= 2 ? points : [];
  } catch {
    return [];
  }
}

/** A route session owns one request; closed or replaced sessions cannot publish stale routes. */
export function createDirectionsSession(
  post: (
    path: string,
    body: object,
    signal: AbortSignal,
  ) => Promise<DirectionsRoute>,
  timeoutMs = 15000,
) {
  let active: AbortController | null = null;
  return {
    cancel() {
      active?.abort();
      active = null;
    },
    async route(
      destination: DirectionsTarget,
      origin: DirectionsPoint,
      mode: DirectionsMode,
    ): Promise<DirectionsRoute | null> {
      active?.abort();
      const request = new AbortController();
      active = request;
      const timer = setTimeout(() => request.abort(), timeoutMs);
      let onAbort: (() => void) | undefined;
      try {
        const result = await Promise.race([
          post(
            "/api/directions/route",
            { destination, origin: { lat: origin.lat, lng: origin.lng }, mode },
            request.signal,
          ),
          new Promise<never>((_, reject) => {
            onAbort = () =>
              reject(new Error("Route calculation timed out. Please retry."));
            request.signal.addEventListener("abort", onAbort, { once: true });
          }),
        ]);
        return active === request && !request.signal.aborted ? result : null;
      } catch (error) {
        if (active !== request) return null;
        throw error;
      } finally {
        clearTimeout(timer);
        if (onAbort) request.signal.removeEventListener("abort", onAbort);
        if (active === request) active = null;
      }
    },
  };
}
