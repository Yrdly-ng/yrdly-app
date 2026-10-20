"use client";

import Link from "next/link";
import { Navigation } from "lucide-react";
import { buildDirectionsHref } from "@/lib/location/directions-client";
import type { DirectionsTarget } from "@/lib/location/directions-types";

export function GetDirectionsLink({
  target,
  className = "",
}: {
  target: DirectionsTarget;
  className?: string;
}) {
  return (
    <Link
      href={buildDirectionsHref(target)}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary/40 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${className}`}
    >
      <Navigation size={17} aria-hidden="true" /> Get directions
    </Link>
  );
}
