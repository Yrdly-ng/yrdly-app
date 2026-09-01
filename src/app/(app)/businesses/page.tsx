"use client";

import { Suspense } from "react";
import { BusinessesScreen } from "@/components/BusinessesScreen";
import { Skeleton } from "@/components/ui/skeleton";

export default function BusinessesPage() {
  return (
    <Suspense fallback={
      <div className="p-4 grid grid-cols-2 gap-3.5">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-44 w-full rounded-2xl" />
        ))}
      </div>
    }>
      <BusinessesScreen />
    </Suspense>
  );
}
