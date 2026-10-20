import { supabase } from "../supabase/supabase";
import {
  coordinates,
  mapCoordinates,
  type MapLocationResolver,
} from "./map-model";

type Point = {
  lat: number;
  lng: number;
  approximate: boolean;
  state?: string;
  lga?: string;
};
type Geocode = (address: string) => Promise<{
  status?: string;
  results?: Array<{
    types?: string[];
    address_components?: Array<{ long_name: string; types: string[] }>;
    geometry?: {
      location?: { lat: number; lng: number };
      location_type?: string;
    };
  }>;
}>;

/** Resolve public content only. Friend coordinates must come from the permission-checked endpoint. */
export function createMapLocationResolver(
  geocode: Geocode,
  timeoutMs = 8000,
): MapLocationResolver {
  const cache = new Map<string, Promise<Point | null>>();
  const waiting: Array<() => void> = [];
  let active = 0;
  async function limited<T>(work: () => Promise<T>): Promise<T> {
    if (active >= 4)
      await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await work();
    } finally {
      active--;
      waiting.shift()?.();
    }
  }
  return async (row, kind, signal) => {
    if (kind === "friend") return row;
    const location =
      kind === "business" ? row.location : row.event_location || row.location;
    const existing = mapCoordinates(row, kind);
    const state = row.state || location?.state;
    const lga = row.lga || location?.lga;
    const ward = row.ward || location?.ward;
    const address =
      row.location_address ||
      (typeof location === "string" ? location : location?.address);
    const usableAddress =
      typeof address === "string" &&
      address.trim() &&
      !/^(tba|tbd|online(?: event)?)$/i.test(address.trim())
        ? address.trim()
        : "";
    const area = [ward, lga, state]
      .filter((value) => typeof value === "string" && value.trim())
      .join(", ");
    const label = usableAddress || area;
    if (!label) return row;
    const key = JSON.stringify([label.toLowerCase(), state, lga, ward]);
    if (!cache.has(key)) {
      const pending = limited(async (): Promise<Point | null> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancel: (() => void) | undefined;
        let stopped = false;
        const checkActive = () => {
          if (stopped || signal?.aborted)
            throw new Error("Address lookup cancelled");
        };
        try {
          checkActive();
          return await Promise.race([
            (async (): Promise<Point | null> => {
              const areaPoint = async (): Promise<Point | null> => {
                checkActive();
                if (!state || !lga) return null;
                const query = () =>
                  supabase
                    .from("lga_wards")
                    .select("latitude,longitude")
                    .eq("state", state)
                    .eq("lga", lga);
                if (ward) {
                  const { data, error } = await query()
                    .eq("ward", ward)
                    .limit(1);
                  if (error) throw new Error("Area lookup unavailable");
                  const point =
                    data?.[0] &&
                    coordinates(data[0].latitude, data[0].longitude);
                  if (point) return { ...point, approximate: true, state, lga };
                }
                const { data, error } = await query().order("ward").limit(200);
                if (error) throw new Error("Area lookup unavailable");
                const points = (data || [])
                  .map((row) => coordinates(row.latitude, row.longitude))
                  .filter(
                    (point): point is { lat: number; lng: number } => !!point,
                  );
                if (!points.length) return null;
                return {
                  lat:
                    points.reduce((sum, point) => sum + point.lat, 0) /
                    points.length,
                  lng:
                    points.reduce((sum, point) => sum + point.lng, 0) /
                    points.length,
                  approximate: true,
                  state,
                  lga,
                };
              };
              // Prefer real venue coordinates; an explicitly labelled area still works if lookup is unavailable.
              if (!usableAddress) {
                const point = await areaPoint();
                if (point) return point;
              }
              let result: Awaited<ReturnType<Geocode>>;
              try {
                result = await geocode(
                  [
                    label,
                    ...(usableAddress ? [lga, state].filter(Boolean) : []),
                    "Nigeria",
                  ].join(", "),
                );
              } catch (error) {
                const point = await areaPoint();
                if (point) return point;
                throw error;
              }
              checkActive();
              if (result.status !== "OK" && result.status !== "ZERO_RESULTS") {
                const point = await areaPoint();
                if (point) return point;
                throw new Error("Address lookup unavailable");
              }
              const canonical = (value: string | undefined) =>
                (value || "")
                  .toLowerCase()
                  .replace(/(?: state| local government area| lga)$/g, "")
                  .replace(/[^a-z0-9]/g, "")
                  .replace(/^(fct|abujafct)$/, "federalcapitalterritory");
              const match = result.results?.find((candidate) => {
                // A country/state centroid is not a venue. Never label another state's result as this area.
                if (
                  candidate.types?.includes("country") ||
                  candidate.types?.includes("administrative_area_level_1")
                )
                  return false;
                const component = (type: string) =>
                  candidate.address_components?.find((entry) =>
                    entry.types.includes(type),
                  )?.long_name;
                const matchedState = component("administrative_area_level_1");
                const matchedLga = component("administrative_area_level_2");
                return (
                  (!state ||
                    !matchedState ||
                    canonical(state) === canonical(matchedState)) &&
                  (!lga ||
                    !matchedLga ||
                    canonical(lga) === canonical(matchedLga))
                );
              });
              const point = coordinates(
                match?.geometry?.location?.lat,
                match?.geometry?.location?.lng,
              );
              return point
                ? {
                    ...point,
                    approximate:
                      !usableAddress ||
                      match?.geometry?.location_type !== "ROOFTOP",
                    state:
                      state ||
                      match?.address_components?.find((component) =>
                        component.types.includes("administrative_area_level_1"),
                      )?.long_name,
                    lga:
                      lga ||
                      match?.address_components?.find((component) =>
                        component.types.includes("administrative_area_level_2"),
                      )?.long_name,
                  }
                : await areaPoint();
            })(),
            new Promise<never>((_, reject) => {
              cancel = () => reject(new Error("Address lookup cancelled"));
              signal?.addEventListener("abort", cancel, { once: true });
              timer = setTimeout(
                () => reject(new Error("Address lookup timed out")),
                timeoutMs,
              );
            }),
          ]);
        } finally {
          stopped = true;
          clearTimeout(timer);
          if (cancel) signal?.removeEventListener("abort", cancel);
        }
      });
      cache.set(key, pending);
      const evict = () => {
        if (cache.get(key) === pending) cache.delete(key);
      };
      void pending.then((point) => {
        if (!point) evict();
      }, evict);
    }
    const point = await cache.get(key)!;
    return point
      ? {
          ...row,
          lat: existing?.lat ?? point.lat,
          lng: existing?.lng ?? point.lng,
          map_approximate: existing ? row.map_approximate : point.approximate,
          map_state: point.state,
          map_lga: point.lga,
        }
      : row;
  };
}
