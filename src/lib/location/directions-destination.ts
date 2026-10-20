import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DirectionsDestination,
  DirectionsTarget,
  DirectionsPoint,
} from "./directions-types";
import { coordinates, mapCoordinates } from "./map-model";
import { getListingCover } from "../marketplace/card-display";

export class DirectionsError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export type DirectionsGeocode = (
  address: string,
  area: { state?: string; lga?: string },
) => Promise<(DirectionsPoint & { approximate: boolean }) | null>;

/** The caller supplies a user-scoped client so the content read always applies RLS. */
export async function resolveDirectionsDestination(
  target: DirectionsTarget,
  client: SupabaseClient,
  options: { userId?: string; geocode?: DirectionsGeocode } = {},
): Promise<DirectionsDestination> {
  const columns = {
    marketplace:
      "id,title,category,is_sold,moderation_status,state,lga,ward,image_urls,image_url,video_thumbnail_url",
    event:
      "id,title,status,moderation_status,visibility,organizer_id,is_archived,location_online,location_address,lat,lng,state,lga,ward,cover_image_url,image_urls",
    "legacy-event":
      "id,title,category,moderation_status,event_link,event_location,location,lat,lng,state,lga,ward,image_urls",
    business:
      "id,name,is_active,location,lat,lng,state,lga,ward,logo_url,image_urls",
  };
  const table =
    target.type === "business"
      ? "businesses"
      : target.type === "event"
        ? "events"
        : "posts";
  const { data: row, error } = await client
    .from(table)
    .select(columns[target.type])
    .eq("id", target.id)
    .maybeSingle();
  if (error)
    throw new DirectionsError(
      "Destination lookup unavailable. Please retry.",
      503,
      "LOOKUP_UNAVAILABLE",
    );
  if (!row)
    throw new DirectionsError(
      "Destination unavailable.",
      404,
      "DESTINATION_UNAVAILABLE",
    );
  const record = row as unknown as Record<string, any>;
  const unavailable =
    (target.type !== "business" && record.moderation_status !== "approved") ||
    (target.type === "event" &&
      (record.status !== "PUBLISHED" ||
        record.is_archived === true ||
        record.location_online === true)) ||
    (target.type === "business" && record.is_active !== true) ||
    (target.type === "marketplace" &&
      (!["For Sale", "Giveaway"].includes(record.category) ||
        record.is_sold === true)) ||
    (target.type === "legacy-event" &&
      (record.category !== "Event" ||
        String(record.event_link || "").startsWith("yrdly://events/")));
  if (unavailable)
    throw new DirectionsError(
      "Destination unavailable.",
      404,
      "DESTINATION_UNAVAILABLE",
    );
  if (
    target.type === "event" &&
    (!options.userId || record.organizer_id !== options.userId)
  ) {
    const visibility = String(record.visibility || "PUBLIC").toUpperCase();
    if (!["PUBLIC", "UNLISTED"].includes(visibility)) {
      let permitted = false;
      if (options.userId && ["WARD_ONLY", "LGA_ONLY"].includes(visibility)) {
        const { data: viewer, error: viewerError } = await client
          .from("users")
          .select("state,lga,ward")
          .eq("id", options.userId)
          .maybeSingle();
        const same = (key: "state" | "lga" | "ward") =>
          typeof record[key] === "string" &&
          record[key].trim() &&
          record[key].trim().toLowerCase() ===
            String(viewer?.[key] || "")
              .trim()
              .toLowerCase();
        permitted =
          !viewerError &&
          !!same("state") &&
          !!same("lga") &&
          (visibility === "LGA_ONLY" || !!same("ward"));
      }
      if (!permitted)
        throw new DirectionsError(
          "Destination unavailable.",
          404,
          "DESTINATION_UNAVAILABLE",
        );
    }
  }
  const title = record.title || record.name || "Destination";
  const image = getListingCover({
    image_urls: [
      record.logo_url,
      record.cover_image_url,
      ...(Array.isArray(record.image_urls) ? record.image_urls : []),
    ],
    image_url: getListingCover(record),
    video_thumbnail_url: record.video_thumbnail_url,
  });
  const location =
    target.type === "business"
      ? record.location
      : record.event_location || record.location;
  const address =
    record.location_address ||
    (typeof location === "string" ? location : location?.address);
  if (
    target.type === "legacy-event" &&
    typeof address === "string" &&
    /^(online(?: event)?|remote)$/i.test(address.trim())
  )
    throw new DirectionsError(
      "Destination unavailable.",
      404,
      "DESTINATION_UNAVAILABLE",
    );
  if (target.type !== "marketplace") {
    let point: (DirectionsPoint & { approximate?: boolean }) | null =
      mapCoordinates(record, target.type === "business" ? "business" : "event");
    const usableAddress =
      typeof address === "string" &&
      address.trim() &&
      !/^(online(?: event)?|tba|tbd|remote)$/i.test(address.trim());
    if (!point && usableAddress && options.geocode) {
      point = await options.geocode(
        [address.trim(), record.lga, record.state, "Nigeria"]
          .filter(Boolean)
          .join(", "),
        { state: record.state, lga: record.lga },
      );
    }
    if (!point)
      throw new DirectionsError(
        "This destination has no physical location yet.",
        422,
        "LOCATION_UNAVAILABLE",
      );
    return {
      ...target,
      title,
      image,
      address: usableAddress ? address.trim() : "",
      ...point,
      approximate: point.approximate === true,
      href: `/${target.type === "legacy-event" ? "posts" : target.type === "business" ? "businesses" : "events"}/${target.id}`,
    };
  }
  if (!record.state || !record.lga)
    throw new DirectionsError(
      "Ask the seller for a pickup location.",
      422,
      "LOCATION_UNAVAILABLE",
    );
  let point: DirectionsPoint | null = null;
  let usedWard = false;
  if (record.ward) {
    const { data: areas, error } = await client
      .from("lga_wards")
      .select("latitude,longitude")
      .eq("state", record.state)
      .eq("lga", record.lga)
      .eq("ward", record.ward)
      .limit(1);
    if (error)
      throw new DirectionsError(
        "Destination lookup unavailable. Please retry.",
        503,
        "LOOKUP_UNAVAILABLE",
      );
    point = areas?.[0]
      ? coordinates(areas[0].latitude, areas[0].longitude)
      : null;
    usedWard = !!point;
  }
  if (!point) {
    const { data: areas, error } = await client
      .from("lga_wards")
      .select("latitude,longitude")
      .eq("state", record.state)
      .eq("lga", record.lga)
      .limit(200);
    if (error)
      throw new DirectionsError(
        "Destination lookup unavailable. Please retry.",
        503,
        "LOOKUP_UNAVAILABLE",
      );
    const points = (areas || []).flatMap((area) => {
      const value = coordinates(area.latitude, area.longitude);
      return value ? [value] : [];
    });
    if (points.length)
      point = {
        lat: points.reduce((sum, value) => sum + value.lat, 0) / points.length,
        lng: points.reduce((sum, value) => sum + value.lng, 0) / points.length,
      };
  }
  if (!point)
    throw new DirectionsError(
      "Ask the seller for a pickup location.",
      422,
      "LOCATION_UNAVAILABLE",
    );
  return {
    ...target,
    title,
    image,
    address: [usedWard ? record.ward : null, record.lga, record.state]
      .filter(Boolean)
      .join(", "),
    ...point,
    approximate: true,
    href: `/marketplace/${target.id}`,
  };
}
