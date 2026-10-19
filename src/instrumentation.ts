import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs")
    await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge")
    await import("../sentry.edge.config");
}

export const onRequestError: Instrumentation.onRequestError = async (
  ...args
) => {
  try {
    const client = Sentry.getClient();
    if (!client || client.getOptions().enabled === false) return;
    // The SDK captures request-local failures; beforeSend removes request data,
    // user information, transaction paths, and all free-form context.
    await Sentry.captureRequestError(...args);
  } catch {
    /* Reporting must never replace the application's original error. */
  }
};
