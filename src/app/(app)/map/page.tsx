"use client";

import { MapScreen } from "@/components/location/MapScreen";
import { Suspense } from "react";

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4">
          Loading map…
        </p>
      }
    >
      <MapScreen />
    </Suspense>
  );
}
