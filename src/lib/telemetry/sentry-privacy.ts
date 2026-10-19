import type { ErrorEvent, StackFrame } from "@sentry/nextjs";

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
): ErrorEvent {
  const operation = event.tags?.operation;
  const code = event.tags?.error_code;
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
      ...(typeof operation === "string" && errorOperations.has(operation)
        ? { operation }
        : {}),
      ...(isErrorCode(code) ? { error_code: code } : {}),
    },
    exception: event.exception
      ? {
          values: event.exception.values?.map((exception) => ({
            type: errorTypes.has(exception.type || "")
              ? exception.type
              : "Error",
            value: "Error details omitted for privacy",
            stacktrace: exception.stacktrace
              ? { frames: exception.stacktrace.frames?.map(cleanFrame) }
              : undefined,
            mechanism: exception.mechanism
              ? {
                  type: /^[a-zA-Z0-9_.-]{1,100}$/.test(exception.mechanism.type)
                    ? exception.mechanism.type
                    : "generic",
                  handled: exception.mechanism.handled,
                }
              : undefined,
          })),
        }
      : undefined,
  };
  if (!safe.exception) safe.message = "Application error";
  return safe;
}
