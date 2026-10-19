import {
  getListingCover,
  getListingPriceLabel,
} from "../marketplace/card-display";

export type MarkerKind = "marketplace" | "event" | "business" | "friend";
export type MapFilter = "all" | MarkerKind;
export interface MapMarker {
  id: string;
  targetId: string;
  type: MarkerKind;
  lat: number;
  lng: number;
  title: string;
  subtitle: string;
  image?: string;
}
export const MARKER_LABELS: Record<MarkerKind, string> = {
  marketplace: "Listing",
  event: "Event",
  business: "Business",
  friend: "Friend",
};
export const MARKER_COLORS: Record<MarkerKind, string> = {
  marketplace: "#82DB7E",
  event: "#FFD077",
  business: "#7CB6FF",
  friend: "#C4AEFF",
};

export function coordinates(
  lat: unknown,
  lng: unknown,
): { lat: number; lng: number } | null {
  const number = (value: unknown) =>
    typeof value === "number" || (typeof value === "string" && value.trim())
      ? Number(value)
      : NaN;
  const latitude = number(lat);
  const longitude = number(lng);
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
    ? { lat: latitude, lng: longitude }
    : null;
}

export function normalizeMarker(
  row: Record<string, any>,
  kind: MarkerKind,
  prefix: string,
  jitter = false,
): MapMarker | null {
  if (typeof row.id !== "string" || !row.id) return null;
  const location =
    kind === "friend"
      ? row.current_location
      : kind === "business"
        ? row.location
        : row.event_location;
  const point = coordinates(
    kind === "friend"
      ? (location?.lat ?? location?.geopoint?.latitude)
      : (row.lat ?? location?.lat ?? location?.geopoint?.latitude),
    kind === "friend"
      ? (location?.lng ?? location?.geopoint?.longitude)
      : (row.lng ?? location?.lng ?? location?.geopoint?.longitude),
  );
  if (!point) return null;
  // Preserve the web map's existing approximate friend/listing positions.
  if (jitter && (kind === "friend" || kind === "marketplace")) {
    point.lat = Math.max(
      -90,
      Math.min(90, point.lat + (Math.random() - 0.5) * 0.002),
    );
    point.lng = Math.max(
      -180,
      Math.min(180, point.lng + (Math.random() - 0.5) * 0.002),
    );
  }
  const title = row.title || row.name;
  const address = row.location_address || location?.address;
  const image = getListingCover({
    image_urls: row.image_urls,
    image_url:
      kind === "friend" ? row.avatar_url : row.cover_image_url || row.image_url,
    video_thumbnail_url: row.video_thumbnail_url,
  });
  return {
    id: `${prefix}-${row.id}`,
    targetId: row.id,
    type: kind,
    ...point,
    title:
      typeof title === "string" && title.trim() ? title : MARKER_LABELS[kind],
    subtitle:
      kind === "friend"
        ? "Approximate shared location"
        : kind === "marketplace"
          ? getListingPriceLabel(
              row.price,
              (value) => `₦${value.toLocaleString("en-NG")}`,
            )
          : typeof address === "string" && address.trim()
            ? address
            : MARKER_LABELS[kind],
    image,
  };
}

export interface MapSource {
  key: string;
  label: string;
  kind: MarkerKind;
  load: () => PromiseLike<{ data: unknown; error?: unknown }>;
}
export async function loadMapSources(
  sources: MapSource[],
  jitter = false,
  timeoutMs = 12000,
) {
  const results = await Promise.all(
    sources.map(async (source) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          Promise.resolve().then(source.load),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
          }),
        ]);
        if (
          result.error ||
          (result.data != null && !Array.isArray(result.data))
        )
          throw new Error("Source unavailable");
        const markers: MapMarker[] = [];
        for (const row of (result.data || []) as Record<string, any>[]) {
          if (!row || typeof row !== "object") continue;
          const marker = normalizeMarker(row, source.kind, source.key, jitter);
          if (marker) markers.push(marker);
        }
        return { markers, failed: "" };
      } catch {
        return { markers: [] as MapMarker[], failed: source.label };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return {
    markers: results.flatMap((result) => result.markers),
    failedSources: results.map((result) => result.failed).filter(Boolean),
  };
}

export function filterMarkers(
  markers: MapMarker[],
  filter: MapFilter,
  search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  return markers.filter(
    (marker) =>
      (filter === "all" || marker.type === filter) &&
      (!query ||
        `${marker.title} ${marker.subtitle}`
          .toLocaleLowerCase()
          .includes(query)),
  );
}
export function markerRoute(marker: MapMarker) {
  const route = {
    marketplace: "marketplace",
    event: "events",
    business: "businesses",
    friend: "profile",
  }[marker.type];
  return `/${route}/${marker.targetId}`;
}

// Filter missing/out-of-range primary coordinates before the server row cap,
// while retaining legacy JSON locations for normalization on the client.
export function mappableRowsFilter(field: "location" | "event_location") {
  return `and(lat.gte.-90,lat.lte.90,lng.gte.-180,lng.lte.180),and(${field}->>lat.not.is.null,${field}->>lng.not.is.null),and(${field}->geopoint->>latitude.not.is.null,${field}->geopoint->>longitude.not.is.null)`;
}

export interface MapEta {
  duration_seconds: number;
  duration_in_traffic_seconds: number;
  distance_meters: number;
  overview_polyline?: string;
}
export function normalizeEta(value: unknown): MapEta | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const valid = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!valid(data.duration_seconds) || !valid(data.distance_meters))
    return null;
  return {
    duration_seconds: data.duration_seconds,
    duration_in_traffic_seconds: valid(data.duration_in_traffic_seconds)
      ? data.duration_in_traffic_seconds
      : data.duration_seconds,
    distance_meters: data.distance_meters,
    overview_polyline:
      typeof data.overview_polyline === "string"
        ? data.overview_polyline
        : undefined,
  };
}
