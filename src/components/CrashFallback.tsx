"use client";

import { useEffect } from "react";
import {
  captureWebError,
  reportWebRecoveryRequested,
} from "@/lib/telemetry/sentry";

/** Next's route error boundary keeps navigation/layouts available after a page fails. */
export function CrashFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    captureWebError(error, { operation: "app.error_boundary" });
  }, [error]);
  return (
    <main
      role="alert"
      style={{
        minHeight: "70vh",
        display: "grid",
        placeContent: "center",
        padding: 24,
        textAlign: "center",
        gap: 16,
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>This page couldn’t load</h1>
      <p>Please try again, or return to your home feed.</p>
      <button
        type="button"
        onClick={() => {
          reportWebRecoveryRequested();
          reset();
        }}
        style={{
          background: "#82DB7E",
          color: "#0B0D0B",
          padding: "12px 24px",
          borderRadius: 12,
          fontWeight: 700,
        }}
      >
        Try again
      </button>
      <a href="/home">Go to home</a>
    </main>
  );
}
