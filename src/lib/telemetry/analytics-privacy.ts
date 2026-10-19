import type { CaptureResult } from "posthog-js";
import { pageRoutes } from "./routes";

export const productEvents = new Set(["message_sent", "business_saved"]);
const allowedEvents = new Set(["$pageview", "$identify", ...productEvents]);
const routes = new Set<string>(pageRoutes);
const identityKeys = new Set([
  "distinct_id",
  "$device_id",
  "$user_id",
  "$anon_distinct_id",
  "$session_id",
  "$window_id",
  "$insert_id",
]);

export function sanitizeAnalyticsEvent(
  event: CaptureResult | null,
  projectToken: string,
): CaptureResult | null {
  if (!event || !allowedEvents.has(event.event)) return null;
  const source = event.properties || {};
  const properties: Record<string, unknown> = {
    // PostHog requires its public project token inside every event.
    token: projectToken,
    app_platform: "web",
    $geoip_disable: true,
  };
  for (const key of identityKeys) {
    const value = source[key];
    if (typeof value === "string" && /^[a-zA-Z0-9_$:-]{1,128}$/.test(value))
      properties[key] = value;
  }
  if (
    ["production", "preview", "development"].includes(source.app_environment)
  ) {
    properties.app_environment = source.app_environment;
  }
  if (typeof source.$process_person_profile === "boolean")
    properties.$process_person_profile = source.$process_person_profile;
  if (typeof source.$is_identified === "boolean")
    properties.$is_identified = source.$is_identified;
  if (event.event === "$pageview") {
    if (!routes.has(source.$pathname)) return null;
    properties.$pathname = source.$pathname;
    properties.$current_url = `https://app.yrdly.ng${source.$pathname}`;
  }
  // Rebuild the payload so arbitrary properties, person updates and URL/referrer data cannot escape.
  return {
    uuid: event.uuid,
    event: event.event,
    timestamp: event.timestamp,
    properties,
  };
}
