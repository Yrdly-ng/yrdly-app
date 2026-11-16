import { diagnosticMessage } from "./diagnostics";
import { pageTemplate, pageRoutes } from "./routes";
const screenRoutes = new Set<string>(pageRoutes);

export const reliabilityEvents = new Set([
  "app_started",
  "app_error",
  "app_recovery_requested",
  "app_memory_warning",
  "app_previous_native_crash",
]);
const actions = new Set([
  "post_created",
  "business_saved",
  "business_created",
  "message_sent",
  "business_save_failed",
  "message_send_failed",
  "ticket_checkout_started",
  "ticket_checkout_failed",
  "ticket_issued",
  "booking_checkout_started",
  "booking_checkout_failed",
  "booking_payment_confirmed",
]);
const operations = new Set([
  "business.save",
  "business.load",
  "chat.send",
  "chat.load",
  "app.error_boundary",
  "app.logger",
  "app.request",
  "notification.actor",
]);
const errorTypes = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "RangeError",
  "URIError",
  "EvalError",
  "AggregateError",
  "SIGABRT",
  "SIGSEGV",
  "OutOfMemoryError",
  "IllegalStateException",
]);
const states = new Set([
  "active",
  "inactive",
  "background",
  "hidden",
  "unknown",
]);
export type DiagnosticBreadcrumb = {
  category: string;
  message: string;
  timestamp?: number;
  level?: "info" | "warning";
};
let sink: ((crumb: DiagnosticBreadcrumb) => void) | undefined;
let clear: (() => void) | undefined;
let currentScreen: string | null = null;
let currentState = "unknown";

export function sanitizeDiagnosticBreadcrumb(
  value: unknown,
): DiagnosticBreadcrumb | null {
  if (!value || typeof value !== "object") return null;
  const b = value as Record<string, unknown>;
  const message = b.message;
  if (typeof message !== "string") return null;
  const valid =
    b.category === "app.navigation"
      ? screenRoutes.has(message)
      : b.category === "app.lifecycle"
        ? states.has(message)
        : b.category === "app.action"
          ? actions.has(message)
          : b.category === "app.recovery"
            ? message === "retry_requested"
            : b.category === "app.memory"
              ? message === "memory_warning"
              : false;
  if (!valid) return null;
  return {
    category: b.category as string,
    message,
    ...(typeof b.timestamp === "number" && Number.isFinite(b.timestamp)
      ? { timestamp: b.timestamp }
      : {}),
    level: b.category === "app.memory" ? "warning" : "info",
  };
}

export function configureDiagnostics(
  add: (crumb: DiagnosticBreadcrumb) => void,
  clearBreadcrumbs: () => void,
): void {
  sink = add;
  clear = clearBreadcrumbs;
}
export function resetDiagnostics(): void {
  currentScreen = null;
  try {
    clear?.();
  } catch {
    /* Diagnostics cannot interrupt account changes. */
  }
}
export function recordDiagnostic(category: string, message: string): void {
  const crumb = sanitizeDiagnosticBreadcrumb({
    category,
    message,
    timestamp: Date.now() / 1000,
  });
  if (crumb) {
    try {
      sink?.(crumb);
    } catch {
      /* Reporting never breaks a user action. */
    }
  }
}
export function setDiagnosticScreen(value: string): string | null {
  const next = pageTemplate(value);
  if (next !== currentScreen && next) recordDiagnostic("app.navigation", next);
  currentScreen = next;
  return next;
}
export function setDiagnosticState(value: string): string {
  const next = states.has(value) ? value : "unknown";
  if (next !== currentState) recordDiagnostic("app.lifecycle", next);
  currentState = next;
  return next;
}
export function diagnosticContext(): { screen?: string; app_state: string } {
  return {
    ...(currentScreen ? { screen: currentScreen } : {}),
    app_state: currentState,
  };
}
export function reliabilityProperties(
  source: Record<string, unknown>,
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  if (typeof source.screen === "string" && screenRoutes.has(source.screen))
    result.screen = source.screen;
  if (typeof source.app_state === "string" && states.has(source.app_state))
    result.app_state = source.app_state;
  if (typeof source.operation === "string" && operations.has(source.operation))
    result.operation = source.operation;
  if (
    typeof source.error_type === "string" &&
    errorTypes.has(source.error_type)
  )
    result.error_type = source.error_type;
  if (typeof source.handled === "boolean") result.handled = source.handled;
  if (typeof source.error_category === "string")
    result.error_category = diagnosticMessage({
      message: source.error_category,
    });
  if (
    typeof source.app_release === "string" &&
    /^[a-f0-9]{7,40}$/.test(source.app_release)
  )
    result.app_release = source.app_release;
  return result;
}
