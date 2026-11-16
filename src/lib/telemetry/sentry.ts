import { captureWebAnalyticsError, trackWebReliability } from "./analytics";
import * as Sentry from "@sentry/nextjs";
import { diagnosticMessage } from './diagnostics';
import { configureDiagnostics, resetDiagnostics, recordDiagnostic, sanitizeDiagnosticBreadcrumb, setDiagnosticScreen, setDiagnosticState, diagnosticContext } from './reliability';
import {
  errorOperations,
  isInjectedBrowserError,
  isErrorCode,
  isTelemetryUserId,
  sanitizeSentryEvent,
} from "./sentry-privacy";

type Runtime = "browser" | "nodejs" | "edge";
let diagnosticUser: string | null = null;
let diagnosticsStarted = false;

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
      maxBreadcrumbs: runtime === 'browser' ? 20 : 0,
      beforeBreadcrumb: runtime === 'browser' ? sanitizeDiagnosticBreadcrumb : () => null,
      beforeSend: (event) => {
        if (runtime === 'browser' && isInjectedBrowserError(event)) return null;
        const safe = sanitizeSentryEvent(event, runtime === 'browser');
        const values = safe.exception?.values;
        if (runtime === 'browser' && values?.length) void trackWebReliability('app_error', {
          ...safe.tags,
          error_category: values[0].value,
          error_type: values[0].type,
          handled: values.every(value => value.mechanism?.handled !== false),
        });
        return safe;
      },
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
    if (runtime === "browser") {
      configureDiagnostics(crumb => Sentry.addBreadcrumb(crumb), () => Sentry.getCurrentScope().clearBreadcrumbs());
      Sentry.setUser(null);
    }
  } catch {
    // Telemetry setup must never prevent the app from loading.
  }
}

export function setWebUser(id: string | null): void {
  if (typeof window === "undefined") return;
  const next = isTelemetryUserId(id) ? id : null;
  if (diagnosticUser !== next) { resetDiagnostics(); diagnosticUser = next; }
  try {
    const client = Sentry.getClient();
    if (client && client.getOptions().enabled !== false) {
      Sentry.setUser(isTelemetryUserId(id) ? { id } : null);
    }
  } catch {
    /* Reporting must never interrupt an authentication transition. */
  }
}

export function setWebScreen(pathname: string): void {
  const screen = setDiagnosticScreen(pathname);
  try { if (Sentry.getClient()) Sentry.setTag('screen', screen || 'unknown'); } catch { /* Optional reporting. */ }
}

export function startWebDiagnostics(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || process.env.NEXT_PUBLIC_TELEMETRY_DISABLED === 'true') return () => {};
  const update = () => {
    const state = setDiagnosticState(document.hidden ? 'hidden' : 'active');
    try { if (Sentry.getClient()) Sentry.setTag('app_state', state); } catch { /* Optional reporting. */ }
  };
  update();
  document.addEventListener('visibilitychange', update);
  return () => document.removeEventListener('visibilitychange', update);
}

export function reportWebAppStarted(): void {
  if (diagnosticsStarted) return;
  diagnosticsStarted = true;
  void trackWebReliability('app_started');
}

export function reportWebRecoveryRequested(): void {
  recordDiagnostic('app.recovery', 'retry_requested');
  void trackWebReliability('app_recovery_requested', diagnosticContext());
}

export function captureWebError(
  error: unknown,
  context?: { operation?: string; code?: string },
): void {
  if (typeof window !== "undefined") void captureWebAnalyticsError(error);
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
        : new Error(diagnosticMessage(error)),
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
