import * as Sentry from "@sentry/nextjs";
import {
  errorOperations,
  isErrorCode,
  isTelemetryUserId,
  sanitizeSentryEvent,
} from "./sentry-privacy";

type Runtime = "browser" | "nodejs" | "edge";

export function initializeWebSentry(runtime: Runtime): void {
  if (process.env.NEXT_PUBLIC_TELEMETRY_DISABLED === "true") return;
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_TELEMETRY_DEBUG !== "true"
  )
    return;
  const dsn = (
    runtime === "browser"
      ? process.env.NEXT_PUBLIC_SENTRY_DSN
      : process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  )?.trim();
  if (!dsn || Sentry.getClient()) return;
  try {
    const configuredEnvironment = process.env.NEXT_PUBLIC_APP_ENV;
    const environment =
      configuredEnvironment === "production" ||
      configuredEnvironment === "preview" ||
      configuredEnvironment === "development"
        ? configuredEnvironment
        : process.env.NODE_ENV === "production"
          ? "production"
          : "development";
    Sentry.init({
      dsn,
      environment,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
        frameContextLines: 0,
      },
      beforeSendLog: () => null,
      beforeSendMetric: () => null,
      // Omitting both sampling options disables tracing entirely.
      tracePropagationTargets: [],
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      maxBreadcrumbs: 0,
      beforeBreadcrumb: () => null,
      beforeSend: (event) => sanitizeSentryEvent(event, runtime === "browser"),
      beforeSendTransaction: () => null,
      integrations: (defaults) =>
        defaults.filter(
          (integration) =>
            ![
              "Breadcrumbs",
              "HttpContext",
              "Replay",
              "BrowserTracing",
              "CaptureConsole",
              "Console",
            ].includes(integration.name),
        ),
    });
    if (runtime === "browser") Sentry.setUser(null);
  } catch {
    // Telemetry setup must never prevent the app from loading.
  }
}

export function setWebUser(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const client = Sentry.getClient();
    if (client && client.getOptions().enabled !== false) {
      Sentry.setUser(isTelemetryUserId(id) ? { id } : null);
    }
  } catch {
    /* Reporting must never interrupt an authentication transition. */
  }
}

export function captureWebError(
  error: unknown,
  context?: { operation?: string; code?: string },
): void {
  try {
    const client = Sentry.getClient();
    if (!client || client.getOptions().enabled === false) return;
    const code =
      context?.code ??
      (error && typeof error === "object" && "code" in error
        ? error.code
        : undefined);
    Sentry.captureException(
      error instanceof Error
        ? error
        : new Error("Application operation failed"),
      {
        tags: {
          ...(context?.operation && errorOperations.has(context.operation)
            ? { operation: context.operation }
            : {}),
          ...(isErrorCode(code) ? { error_code: code } : {}),
        },
      },
    );
  } catch {
    /* Reporting must never turn a handled error into another failure. */
  }
}
