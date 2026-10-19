import { initializeWebSentry } from "./lib/telemetry/sentry";

initializeWebSentry("browser");
// Router tracing is intentionally disabled; route analytics uses sanitized templates.
