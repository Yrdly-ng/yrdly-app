import type { SupabaseClient } from "@supabase/supabase-js";

export type DiscoverFilter = "all" | "neighbors" | "mutuals" | "sellers";
export interface PublicPerson {
  id: string;
  name: string;
  avatar_url?: string;
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
    userId: string;
    filter: DiscoverFilter;
    location: { state?: string; lga?: string } | null;
    signal: AbortSignal;
  },
): Promise<PublicPerson[]> {
  const { userId, filter, location, signal } = options;
  if (!location?.state || !location.lga) return [];
  let query = client
    .from("public_profiles")
    .select("id, name, avatar_url, home_state, home_lga, discoverable")
    .neq("id", userId)
    .or("discoverable.is.null,discoverable.eq.true")
    .order("created_at", { ascending: false });
  query = query.eq("home_state", location.state).eq("home_lga", location.lga);
  const { data, error } = await query.limit(100).abortSignal(signal);
  if (error || !Array.isArray(data))
    throw new Error("Unable to load nearby people");
  let people = data
    .filter((row) => row?.discoverable !== false)
    .map(publicPerson)
    .filter(
      (person): person is PublicPerson => !!person && person.id !== userId,
    );
  if (filter === "mutuals") {
    const result = await client
      .rpc("get_mutual_friends", {
        p_user_id: userId,
        p_limit: 100,
        p_offset: 0,
      })
      .abortSignal(signal);
    if (result.error || !Array.isArray(result.data))
      throw new Error("Unable to load mutual friends");
    const ids = new Set(result.data.map((row: { id?: unknown }) => row?.id));
    people = people.filter((person) => ids.has(person.id));
  }
  if (filter === "sellers") {
    let posts = client
      .from("posts")
      .select("user_id")
      .eq("category", "For Sale")
      .eq("is_sold", false);
    posts = posts.eq("state", location.state).eq("lga", location.lga);
    const result = await posts.limit(100).abortSignal(signal);
    if (result.error || !Array.isArray(result.data))
      throw new Error("Unable to load sellers");
    const ids = new Set(result.data.map((row) => row?.user_id));
    people = people.filter((person) => ids.has(person.id));
  }
  return people;
}
