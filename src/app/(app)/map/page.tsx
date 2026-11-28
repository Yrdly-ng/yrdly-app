"use client";

import { MapScreen } from "@/components/location/MapScreen";
import { GoogleMapsProvider } from "@/components/providers/GoogleMapsProvider";
import { Suspense } from "react";

export default function MapPage() {
  return (
    <GoogleMapsProvider>
      <Suspense
        fallback={
          <p role="status" className="p-4">
            Loading map…
          </p>
        }
      >
        <MapScreen />
      </Suspense>
    </GoogleMapsProvider>
  );
}
