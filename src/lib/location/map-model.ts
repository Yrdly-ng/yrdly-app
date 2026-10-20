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
  state?: string;
  lga?: string;
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

/** Choose a complete valid pair; never combine coordinates from different locations. */
export function mapCoordinates(row: Record<string, any>, kind: MarkerKind) {
  const candidates =
    kind === "friend"
      ? [row.current_location]
      : [
          row,
          ...(kind === "business"
            ? [row.location]
            : [row.event_location, row.location]),
        ];
  for (const value of candidates) {
    if (!value || typeof value !== "object") continue;
    const point =
      coordinates(value.lat, value.lng) ||
      coordinates(value.latitude, value.longitude) ||
      coordinates(value.geopoint?.latitude, value.geopoint?.longitude);
    if (point) return point;
  }
  return null;
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
        : row.event_location || row.location;
  const point = mapCoordinates(row, kind);
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
  const approximation = row.map_approximate ? " · Approximate area" : "";
  const image =
    getListingCover({
      image_urls:
        kind === "business"
          ? [row.logo_url, row.logo]
          : kind === "event"
            ? [row.cover_image_url]
            : kind === "friend"
              ? [row.avatar_url]
              : [],
    }) ||
    getListingCover({
      image_urls: row.image_urls,
      image_url:
        kind === "friend"
          ? row.avatar_url
          : row.cover_image_url || row.image_url,
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
            ) + approximation
          : typeof address === "string" && address.trim()
            ? address + approximation
            : MARKER_LABELS[kind] + approximation,
    image,
    state: row.state || location?.state || row.map_state,
    lga: row.lga || location?.lga || row.map_lga,
  };
}

export interface MapSource {
  key: string;
  label: string;
  kind: MarkerKind;
  load: () => PromiseLike<{ data: unknown; error?: unknown }>;
}
export type MapLocationResolver = (
  row: Record<string, any>,
  kind: MarkerKind,
  signal?: AbortSignal,
) => Promise<Record<string, any>>;

export async function loadMapSources(
  sources: MapSource[],
  jitter = false,
  timeoutMs = 12000,
  resolveLocation?: MapLocationResolver,
  signal?: AbortSignal,
) {
  const results = await Promise.all(
    sources.map(async (source) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const completed = new Map<number, MapMarker>();
      let failed = false;
      let loaded = false;
      const unresolved = new Set<number>();
      let finished = false;
      const controller = new AbortController();
      let cancel: (() => void) | undefined;
      try {
        // The deadline covers both database loading and subsequent address resolution.
        await Promise.race([
          (async () => {
            if (signal?.aborted) throw new Error("Cancelled");
            const result = await source.load();
            if (finished) return;
            if (
              result.error ||
              (result.data != null && !Array.isArray(result.data))
            )
              throw new Error("Source unavailable");
            loaded = true;
            await Promise.all(
              ((result.data || []) as Record<string, any>[]).map(
                async (row, index) => {
                  if (!row || typeof row !== "object") return;
                  const existing = normalizeMarker(
                    row,
                    source.kind,
                    source.key,
                    jitter,
                  );
                  if (existing) completed.set(index, existing);
                  else unresolved.add(index);
                  if (
                    source.kind === "friend" ||
                    !resolveLocation ||
                    (existing?.state && existing?.lga)
                  )
                    return;
                  try {
                    const located = await resolveLocation(
                      row,
                      source.kind,
                      controller.signal,
                    );
                    if (finished) return;
                    const marker = normalizeMarker(
                      located,
                      source.kind,
                      source.key,
                      jitter,
                    );
                    if (marker) {
                      completed.set(index, marker);
                      unresolved.delete(index);
                    }
                  } catch {
                    // A failed lookup does not mean the database source failed.
                    // Existing coordinates remain usable even without area enrichment.
                  }
                },
              ),
            );
          })(),
          new Promise<never>((_, reject) => {
            cancel = () => reject(new Error("Cancelled"));
            if (signal?.aborted) cancel();
            else signal?.addEventListener("abort", cancel, { once: true });
            timer = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
          }),
        ]);
      } catch {
        failed = !loaded;
      } finally {
        finished = true;
        controller.abort();
        if (cancel) signal?.removeEventListener("abort", cancel);
        clearTimeout(timer);
      }
      return {
        markers: [...completed.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, marker]) => marker),
        failed: failed ? source.label : "",
        unresolved: loaded && unresolved.size ? source.label : "",
      };
    }),
  );
  return {
    markers: results.flatMap((result) => result.markers),
    failedSources: results.map((result) => result.failed).filter(Boolean),
    unresolvedSources: results
      .map((result) => result.unresolved)
      .filter(Boolean),
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
  if (marker.id.startsWith("legacy-event-")) return `/posts/${marker.targetId}`;
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

/** Legacy rows can be selected by resolved area without leaking unrelated areas into the results. */
export function matchesMapArea(
  marker: MapMarker,
  area?: { state?: string; lga?: string } | null,
) {
  if (marker.type === "friend") return true;
  const canonical = (value: string | undefined) =>
    (typeof value === "string" ? value : "")
      .toLowerCase()
      .replace(/(?: state| local government area| lga)$/g, "")
      .replace(/[^a-z0-9]/g, "")
      .replace(/^(fct|abujafct)$/, "federalcapitalterritory");
  return (
    (!area?.state || canonical(marker.state) === canonical(area.state)) &&
    (!area?.lga || canonical(marker.lga) === canonical(area.lga))
  );
}
