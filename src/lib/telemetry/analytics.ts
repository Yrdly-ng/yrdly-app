import type { PostHog } from "posthog-js";
import { isTelemetryUserId } from "./sentry-privacy";
import { productEvents, sanitizeAnalyticsEvent } from "./analytics-privacy";
import { pageTemplate } from "./routes";

let client: PostHog | undefined;
let initializing: Promise<void> | undefined;
let desiredUser: string | null = null;
let appliedUser: string | null = null;
let lastPath: string | null = null;

function enabled(): boolean {
  return (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_TELEMETRY_DISABLED !== "true" &&
    (process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_TELEMETRY_DEBUG === "true")
  );
}

function environment(): string {
  const value = process.env.NEXT_PUBLIC_APP_ENV;
  return value === "production" ||
    value === "preview" ||
    value === "development"
    ? value
    : process.env.NODE_ENV === "production"
      ? "production"
      : "development";
}

function applyIdentity(): void {
  if (!client || appliedUser === desiredUser) return;
  if (appliedUser) client.reset(true);
  if (desiredUser) client.identify(desiredUser);
  appliedUser = desiredUser;
}

export function setWebAnalyticsUser(id: string | null): void {
  desiredUser = isTelemetryUserId(id) ? id : null;
  try {
    applyIdentity();
  } catch {
    /* Analytics cannot block account changes. */
  }
}

export async function initializeWebAnalytics(): Promise<void> {
  const key =
    process.env.NEXT_PUBLIC_POSTHOG_KEY ||
    process.env.NEXT_PUBLIC_POSTHOG_API_KEY;
  if (!enabled() || !key || client) return;
  if (!initializing) {
    initializing = (async () => {
      const { default: posthog } = await import("posthog-js");
      posthog.init(key, {
        api_host: "/ingest",
        ui_host: /^https:\/\/eu(?:\.i)?\.posthog\.com\/?$/.test(
          process.env.NEXT_PUBLIC_POSTHOG_HOST || "",
        )
          ? "https://eu.posthog.com"
          : "https://us.posthog.com",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_exceptions: false,
        capture_dead_clicks: false,
        capture_heatmaps: false,
        capture_performance: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_external_dependency_loading: true,
        advanced_disable_flags: true,
        advanced_disable_feature_flags: true,
        advanced_disable_toolbar_metrics: true,
        persistence: "memory",
        person_profiles: "identified_only",
        ip: false,
        before_send: (event) => sanitizeAnalyticsEvent(event, key),
      });
      client = posthog;
      // Identify receives no email, name, phone, location, or profile properties.
      applyIdentity();
    })().catch(() => {
      initializing = undefined;
    });
  }
  await initializing;
}

export async function trackWebPage(pathname: string): Promise<void> {
  const template = pageTemplate(pathname);
  if (!template || !enabled()) return;
  try {
    await initializeWebAnalytics();
    if (!client || lastPath === pathname) return;
    client.capture("$pageview", {
      $pathname: template,
      app_environment: environment(),
    });
    lastPath = pathname;
  } catch {
    /* Analytics cannot interrupt navigation. */
  }
}

export async function trackWebEvent(
  event: "message_sent" | "business_saved",
): Promise<void> {
  if (!enabled() || !productEvents.has(event)) return;
  try {
    await initializeWebAnalytics();
    client?.capture(event, { app_environment: environment() });
  } catch {
    /* Analytics cannot interrupt the action being measured. */
  }
}
