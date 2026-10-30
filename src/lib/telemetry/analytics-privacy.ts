import { diagnosticMessage } from './diagnostics';
import type { CaptureResult } from "posthog-js";
import { pageRoutes } from "./routes";
import { deviceLabel, homeState } from "./metadata";

export const productEvents = new Set(["message_sent", "business_saved", "ticket_checkout_started", "ticket_checkout_opened", "ticket_checkout_failed", "ticket_verification_failed", "ticket_issued", "ticket_refund_requested", "ticket_refund_failed", "event_withdrawal_requested", "event_withdrawal_failed", "booking_checkout_started", "booking_payment_confirmed", "booking_checkout_failed"]);
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
  if (!event) return null;
  if (event.event === '$snapshot') {
    const source = event.properties || {};
    const properties: Record<string, unknown> = { token: projectToken };
    for (const key of ['$snapshot_data', '$snapshot_bytes', '$session_id', '$window_id', '$lib', '$lib_version', '$snapshot_host', ...identityKeys]) {
      if (source[key] !== undefined) properties[key] = source[key];
    }
    const snapshots = Array.isArray(properties.$snapshot_data) ? properties.$snapshot_data : [];
    properties.$snapshot_data = snapshots.filter(snapshot => snapshot && typeof snapshot === 'object' && (snapshot as { type?: number }).type !== 5 && (snapshot as { type?: number }).type !== 6).map(snapshot => {
      const entry = snapshot as { type?: number; data?: { href?: string; width?: number; height?: number }; timestamp?: number };
      if (entry.type !== 4) return snapshot;
      return { type: 4, timestamp: entry.timestamp, data: { href: 'https://app.yrdly.ng/', width: entry.data?.width, height: entry.data?.height } };
    });
    return { event: event.event, uuid: event.uuid, timestamp: event.timestamp, properties };
  }
  if (event.event === '$exception') {
    const source = event.properties || {};
    const list = Array.isArray(source.$exception_list) ? source.$exception_list as Record<string, unknown>[] : [];
    return { event: event.event, uuid: event.uuid, timestamp: event.timestamp, properties: {
      token: projectToken, app_platform: 'web', $geoip_disable: true,
      ...Object.fromEntries(['$session_id', '$window_id', 'distinct_id'].filter(key => typeof source[key] === 'string').map(key => [key, source[key]])),
      $exception_list: list.map(exception => ({ type: ['Error','TypeError','RangeError','ReferenceError','SyntaxError'].includes(String(exception.type)) ? exception.type : 'Error', value: diagnosticMessage({message:exception.value}) })),
    } };
  }
  if (!allowedEvents.has(event.event)) return null;
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
  for (const key of ['$browser', '$os']) {
    const value = deviceLabel(source[key]);
    if (value) properties[key] = value;
  }
  for (const key of ['$browser_version', '$os_version']) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
      properties[key] = value;
    else if (typeof value === 'string' && /^[0-9][0-9._-]{0,39}$/.test(value))
      properties[key] = value;
  }
  if (['Desktop', 'Mobile', 'Tablet'].includes(source.$device_type))
    properties.$device_type = source.$device_type;
  const state = homeState(source.home_state);
  if (state && source.$is_identified === true) properties.home_state = state;
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
