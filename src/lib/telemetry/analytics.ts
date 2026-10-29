import { diagnosticMessage } from './diagnostics';
import type { PostHog } from "posthog-js";
import { isTelemetryUserId } from "./sentry-privacy";
import { productEvents, sanitizeAnalyticsEvent } from "./analytics-privacy";
import { pageTemplate } from "./routes";

let client: PostHog | undefined;
let initializing: Promise<void> | undefined;
let desiredUser: string | null = null;
let appliedUser: string | null = null;
let lastPath: string | null = null;
let desiredReplay = false;

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
        session_recording: {
          maskAllInputs: true, maskTextSelector: '*', maskAllElementAttributes: true,
          blockSelector: 'img,video,audio,canvas,iframe,svg,object,embed,[data-private]',
          recordHeaders: false, recordBody: false, captureJsonLd: false,
          inlineStylesheet: false, collectFonts: false, slimDOMOptions: "all",
          maskCapturedNetworkRequestFn: () => null,
        },
        enable_recording_console_log: false,
        disable_surveys: true,
        disable_external_dependency_loading: false,
        advanced_disable_flags: false,
        advanced_disable_feature_flags: true,
        advanced_disable_toolbar_metrics: true,
        persistence: "memory",
        person_profiles: "identified_only",
        ip: false,
        before_send: (event) => sanitizeAnalyticsEvent(event, key),
      });
      client = posthog;
      if (desiredReplay) client.startSessionRecording();
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
  try {
    desiredReplay = enabled() && !!template && [
      '/businesses', '/businesses/[businessId]', '/businesses/[businessId]/catalog/[itemId]',
      '/events', '/events/[id]', '/marketplace', '/marketplace/[itemId]', '/explore',
    ].includes(template);
    if (client && !desiredReplay) client.stopSessionRecording();
    if (!template || !enabled()) return;
    await initializeWebAnalytics();
    if (client && desiredReplay) client.startSessionRecording();
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
  event: string,
): Promise<void> {
  if (!enabled() || !productEvents.has(event)) return;
  try {
    await initializeWebAnalytics();
    client?.capture(event, { app_environment: environment() });
  } catch {
    /* Analytics cannot interrupt the action being measured. */
  }
}

export async function captureWebAnalyticsError(error: unknown): Promise<void> {
  try {
    await initializeWebAnalytics();
    client?.captureException(new Error(diagnosticMessage(error)));
  } catch { /* Analytics never interrupts error recovery. */ }
}
