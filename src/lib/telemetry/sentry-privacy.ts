import { diagnosticMessage } from './diagnostics';
import type { ErrorEvent, StackFrame } from "@sentry/nextjs";
import { reliabilityProperties, sanitizeDiagnosticBreadcrumb } from './reliability';

const errorTypes = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "RangeError",
  "URIError",
  "EvalError",
  "AggregateError",
]);
export const errorOperations = new Set([
  "business.save",
  "business.load",
  "chat.send",
  "chat.load",
  "app.error_boundary",
  "app.logger",
  "app.request",
  "notification.actor",
  "maps.load",
  "maps.auth",
]);

export function isTelemetryUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isErrorCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[0-9]{2}[0-9A-Z]{3}|PGRST[0-9]{3})$/.test(value)
  );
}

// Preserve compiled paths so debug IDs and source maps can resolve frames, while
// removing credentials, query strings, fragments, and local machine prefixes.
function codeFilename(value?: string): string | undefined {
  if (!value) return undefined;
  const clean = value.split(/[?#]/)[0];
  if (/^https?:\/\//.test(clean)) {
    try {
      const url = new URL(clean);
      if (url.origin === 'https://maps.googleapis.com' && url.pathname === '/maps/api/js') {
        return `${url.origin}${url.pathname}`;
      }
      return /\.(?:[cm]?js|tsx?)$/.test(url.pathname)
        ? `${url.origin}${url.pathname}`
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (/^(?:webpack(?:-internal)?:|app:\/\/\/)/.test(clean)) return clean;
  const nextPath = clean.indexOf("/.next/");
  if (nextPath >= 0) return `app:///${clean.slice(nextPath + 1)}`;
  return clean.split("/").pop();
}

function cleanFrame(frame: StackFrame): StackFrame {
  return {
    filename: codeFilename(frame.filename),
    abs_path: codeFilename(frame.abs_path),
    function:
      frame.function && /^[a-zA-Z0-9_.$<> [\]-]{1,160}$/.test(frame.function)
        ? frame.function
        : undefined,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
  };
}

export function sanitizeSentryEvent(
  event: ErrorEvent,
  browser = false,
  originalException?: unknown,
): ErrorEvent {
  const candidateOperation = event.tags?.operation;
  const operation = typeof candidateOperation === "string" && errorOperations.has(candidateOperation)
    ? candidateOperation
    : undefined;
  const code = event.tags?.error_code;
  const reliability = browser ? reliabilityProperties({ screen: event.tags?.screen, app_state: event.tags?.app_state }) : {};
  const safeScreen = reliability.screen;
  const safe: ErrorEvent = {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    dist: event.dist,
    environment: event.environment,
    sdk: event.sdk,
    // Preserve debug IDs and use the same filenames as sanitized stack frames.
    debug_meta: event.debug_meta
      ? {
          images: event.debug_meta.images
            ?.filter((image) => image.type === "sourcemap")
            .map((image) => ({
              type: "sourcemap" as const,
              debug_id: image.debug_id,
              code_file: codeFilename(image.code_file) || "unknown",
            })),
        }
      : undefined,
    user:
      browser && isTelemetryUserId(event.user?.id)
        ? { id: event.user.id }
        : undefined,
    tags: {
      platform: "web",
      ...reliability,
      ...(operation ? { operation } : {}),
      ...(isErrorCode(code) ? { error_code: code } : {}),
    },
    breadcrumbs: browser ? event.breadcrumbs?.slice(-20).map(sanitizeDiagnosticBreadcrumb).filter((value): value is NonNullable<typeof value> => value !== null) : undefined,
    exception: event.exception
      ? {
          values: event.exception.values?.map((exception, index, exceptions) => {
            const type = exception.type && errorTypes.has(exception.type) ? exception.type : 'Error';
            const category = diagnosticMessage({ message: exception.value });
            const original = index === exceptions.length - 1
              ? diagnosticMessage(originalException)
              : 'Application operation failed';
            const classified = category === 'Application operation failed' ||
              (category === 'JavaScript identifier unavailable' && original.startsWith('JavaScript identifier unavailable: '))
              ? original
              : category;
            const frames = exception.stacktrace?.frames?.map(cleanFrame);
            const origin = frames?.at(-1);
            const fromMaps = [origin?.filename, origin?.abs_path].some(path =>
              path === 'https://maps.googleapis.com/maps/api/js' || path === 'app:///maps/api/js',
            );
            const context = operation || (fromMaps ? 'Google Maps runtime' : safeScreen);
            const location = context ? ` in ${context}` : '';
            return {
              type,
              value: classified === 'Application operation failed'
                ? `${type}${location}: cause unclassified`
                : classified,
              stacktrace: exception.stacktrace ? { frames } : undefined,
              mechanism: exception.mechanism
                ? {
                    type: /^[a-zA-Z0-9_.-]{1,100}$/.test(exception.mechanism.type)
                      ? exception.mechanism.type
                      : "generic",
                    handled: exception.mechanism.handled,
                  }
                : undefined,
            };
          }),
        }
      : undefined,
  };
  if (!safe.exception) safe.message = "Application error";
  return safe;
}

/** Ignore only wholly injected extension stacks; mixed application stacks remain visible. */
export function isInjectedBrowserError(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.flatMap(value => value.stacktrace?.frames || []) || [];
  return frames.length > 0 && frames.every(frame => {
    const filename = frame.filename || frame.abs_path || '';
    return /^(?:chrome|moz|safari-web)-extension:\/\//.test(filename) || /^app:\/\/\/scripts\/inpage\.js$/.test(filename);
  });
}
