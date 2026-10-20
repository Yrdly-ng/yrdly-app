import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DirectionsError,
  resolveDirectionsDestination,
  type DirectionsGeocode,
} from "./directions-destination";
import { coordinates } from "./map-model";
import { decodeRoutePolyline } from "./directions-client";
import type { DirectionsTarget, DirectionsRoute } from "./directions-types";

type Dependencies = {
  authenticate: (
    request: Request,
  ) => Promise<
    { userId: string; client: SupabaseClient } | { errorStatus: number }
  >;
  consumeLimit: (userId: string, endpoint: string) => Promise<boolean>;
  fetch: typeof fetch;
  directionsKey?: string;
  geocodeKey?: string;
};
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const invalid = () =>
  new DirectionsError(
    "Choose a destination, a valid starting point and driving or walking.",
    400,
    "INVALID_REQUEST",
  );
function target(value: unknown): DirectionsTarget {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const entry = value as Record<string, unknown>;
  if (
    Object.keys(entry).some((key) => !["type", "id"].includes(key)) ||
    !["marketplace", "event", "legacy-event", "business"].includes(
      String(entry.type),
    ) ||
    typeof entry.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)
  )
    throw invalid();
  return { type: entry.type as DirectionsTarget["type"], id: entry.id };
}
function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (_, entity: string) => {
        const names: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        };
        if (!entity.startsWith("#")) return names[entity.toLowerCase()] || "";
        const point =
          entity[1].toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : "";
      },
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}
function metric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new DirectionsError(
      "The route returned incomplete information. Please retry.",
      502,
      "INVALID_ROUTE",
    );
  return value;
}

export function createDirectionsHandlers(deps: Dependencies) {
  async function run(request: Request, kind: "destination" | "route") {
    try {
      const account = await deps.authenticate(request);
      if ("errorStatus" in account)
        return reply(
          { error: "Please sign in with an active account." },
          account.errorStatus,
        );
      if (!(await deps.consumeLimit(account.userId, `/api/directions/${kind}`)))
        return reply(
          { error: "Too many requests. Please try again shortly." },
          429,
        );
      let destinationTarget: DirectionsTarget;
      let body: Record<string, any> = {};
      if (kind === "destination") {
        const query = new URL(request.url).searchParams;
        if (
          query.getAll("type").length !== 1 ||
          query.getAll("id").length !== 1
        )
          throw invalid();
        destinationTarget = target({
          type: query.get("type"),
          id: query.get("id"),
        });
      } else {
        const raw = await request.text();
        if (raw.length > 4096) throw invalid();
        try {
          body = JSON.parse(raw);
        } catch {
          throw invalid();
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw invalid();
        destinationTarget = target(body.destination);
        if (
          typeof body.origin?.lat !== "number" ||
          typeof body.origin?.lng !== "number" ||
          !coordinates(body.origin.lat, body.origin.lng) ||
          !["driving", "walking"].includes(body.mode)
        )
          throw invalid();
      }
      const geocode: DirectionsGeocode = async (address, area) => {
        if (!deps.geocodeKey)
          throw new DirectionsError(
            "Address lookup is temporarily unavailable. Please retry later.",
            503,
            "PROVIDER_UNAVAILABLE",
          );
        const url = new URL(
          "https://maps.googleapis.com/maps/api/geocode/json",
        );
        url.search = new URLSearchParams({
          address,
          components: "country:NG",
          key: deps.geocodeKey,
        }).toString();
        const response = await deps.fetch(url, {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok)
          throw new DirectionsError(
            "Address lookup is temporarily unavailable.",
            502,
            "PROVIDER_UNAVAILABLE",
          );
        const data = await response.json();
        if (data.status === "ZERO_RESULTS") return null;
        if (data.status !== "OK")
          throw new DirectionsError(
            "Address lookup is temporarily unavailable.",
            503,
            "PROVIDER_UNAVAILABLE",
          );
        const canonical = (value: unknown) =>
          String(value || "")
            .toLowerCase()
            .replace(/\b(state|local government area|lga)\b/g, "")
            .replace(/[^a-z0-9]/g, "");
        for (const result of Array.isArray(data.results)
          ? data.results.slice(0, 10)
          : []) {
          const components = Array.isArray(result.address_components)
            ? result.address_components
            : [];
          const component = (type: string) =>
            components.find(
              (part: any) =>
                Array.isArray(part.types) && part.types.includes(type),
            );
          if (component("country")?.short_name !== "NG") continue;
          if (
            area.state &&
            canonical(component("administrative_area_level_1")?.long_name) !==
              canonical(area.state)
          )
            continue;
          if (
            area.lga &&
            canonical(component("administrative_area_level_2")?.long_name) !==
              canonical(area.lga)
          )
            continue;
          const point = coordinates(
            result.geometry?.location?.lat,
            result.geometry?.location?.lng,
          );
          if (point && result.partial_match !== true)
            return {
              ...point,
              approximate: result.geometry?.location_type !== "ROOFTOP",
            };
        }
        return null;
      };
      const destination = await resolveDirectionsDestination(
        destinationTarget,
        account.client,
        { userId: account.userId, geocode },
      );
      if (kind === "destination") return reply(destination);
      if (!deps.directionsKey)
        throw new DirectionsError(
          "Routing is temporarily unavailable. Please retry later.",
          503,
          "PROVIDER_UNAVAILABLE",
        );
      const url = new URL(
        "https://maps.googleapis.com/maps/api/directions/json",
      );
      url.search = new URLSearchParams({
        origin: `${body.origin.lat},${body.origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
        mode: body.mode,
        key: deps.directionsKey,
      }).toString();
      if (body.mode === "driving")
        url.searchParams.set("departure_time", "now");
      const response = await deps.fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok)
        throw new DirectionsError(
          "Routing is temporarily unavailable. Please retry.",
          502,
          "PROVIDER_UNAVAILABLE",
        );
      const data = await response.json();
      if (data.status === "ZERO_RESULTS" || data.status === "NOT_FOUND")
        throw new DirectionsError(
          "No route found. Try another starting point or travel mode.",
          422,
          "NO_ROUTE",
        );
      if (data.status !== "OK")
        throw new DirectionsError(
          "Routing is temporarily unavailable. Please retry later.",
          503,
          "PROVIDER_UNAVAILABLE",
        );
      const route = data.routes?.[0];
      const leg = route?.legs?.[0];
      if (
        !leg ||
        !decodeRoutePolyline(route.overview_polyline?.points).length ||
        !Array.isArray(leg.steps)
      )
        throw new DirectionsError(
          "The route returned incomplete information. Please retry.",
          502,
          "INVALID_ROUTE",
        );
      const result: DirectionsRoute = {
        destination,
        mode: body.mode,
        overview_polyline: route.overview_polyline.points,
        distance_meters: metric(leg.distance?.value),
        duration_seconds: metric(
          (body.mode === "driving" ? leg.duration_in_traffic : undefined)
            ?.value ?? leg.duration?.value,
        ),
        steps: leg.steps.slice(0, 500).map((step: any) => ({
          instruction: plainText(step.html_instructions),
          distance_meters: metric(step.distance?.value),
          duration_seconds: metric(step.duration?.value),
        })),
        warnings: [
          ...(Array.isArray(route.warnings) ? route.warnings.slice(0, 20) : []),
          route.copyrights,
        ]
          .map(plainText)
          .filter(Boolean),
      };
      return reply(result);
    } catch (error) {
      return error instanceof DirectionsError
        ? reply({ error: error.message, code: error.code }, error.status)
        : reply(
            { error: "Directions are temporarily unavailable. Please retry." },
            503,
          );
    }
  }
  return {
    destination: (request: Request) => run(request, "destination"),
    route: (request: Request) => run(request, "route"),
  };
}
