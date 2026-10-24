import type { SupabaseClient } from "@supabase/supabase-js";

export type DiscoverFilter = "all" | "neighbors" | "mutuals" | "sellers";
export interface PublicPerson {
  id: string;
  name: string;
  avatar_url?: string;
  username?: string;
  phone_verified?: boolean;
  distance_band?: string;
  location: { state?: string; lga?: string };
}
const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;
export function publicPerson(value: unknown): PublicPerson | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!text(row.id)) return null;
  const location =
    row.location && typeof row.location === "object"
      ? (row.location as Record<string, unknown>)
      : {};
  return {
    id: row.id as string,
    name: text(row.name) || "Yrdly neighbor",
    avatar_url: text(row.avatar_url),
    username: text(row.username),
    phone_verified: row.phone_verified === true,
    distance_band: text(row.distance_band),
    location: {
      state: text(row.home_state) || text(location.state),
      lga: text(row.home_lga) || text(location.lga),
    },
  };
}

// Bound the entire operation, including auth/token refresh before the HTTP request starts.
export async function boundedPeopleRequest<T>(
  controller: AbortController,
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 12000,
): Promise<T> {
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error("People request interrupted"));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (controller.signal.aborted)
      throw new Error("People request interrupted");
    return await Promise.race([work(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}

export async function loadNearbyPeople(
  client: SupabaseClient,
  options: {
    coordinates: { latitude: number; longitude: number };
    radiusMeters?: number;
    filter: DiscoverFilter;
    search?: string;
    limit?: number;
    offset?: number;
    signal: AbortSignal;
  },
): Promise<PublicPerson[]> {
  const { coordinates, radiusMeters = 10000, filter, search, limit = 20, offset = 0, signal } = options;
  const { data, error } = await client.rpc("nearby_people", {
    p_latitude: coordinates.latitude,
    p_longitude: coordinates.longitude,
    p_radius_meters: radiusMeters,
    p_filter: filter,
    p_search: search?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  }).abortSignal(signal);
  if (error || !Array.isArray(data)) throw new Error("Unable to load nearby people");
  return data.map(publicPerson).filter((person): person is PublicPerson => !!person);
}
