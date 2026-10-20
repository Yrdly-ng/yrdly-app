import type { DirectionsRoute } from "@/lib/location/directions-types";

export function DirectionsSummary({ route }: { route: DirectionsRoute }) {
  const distance =
    route.distance_meters < 1000
      ? `${Math.round(route.distance_meters)} m`
      : `${(route.distance_meters / 1000).toFixed(1)} km`;
  return (
    <div className="space-y-3">
      <p className="text-lg font-bold" role="status">
        {Math.max(1, Math.ceil(route.duration_seconds / 60))} min · {distance}
        <span className="ml-2 text-xs font-normal text-[#C7D5CB]">
          {route.mode === "walking" ? "Walking" : "Driving"} estimate
        </span>
      </p>
      {route.destination.approximate && (
        <p className="rounded-xl bg-amber-300/10 p-3 text-sm text-amber-100">
          {route.destination.type === "marketplace"
            ? "Approximate pickup area. Ask the seller for the agreed pickup point before travelling."
            : "Approximate destination. Confirm the exact entrance before travelling."}
        </p>
      )}
      {route.warnings.map((warning, index) => (
        <p key={`${index}-${warning}`} className="text-xs text-amber-100">
          {warning}
        </p>
      ))}
      <details className="rounded-xl border border-white/15 p-3">
        <summary className="min-h-8 cursor-pointer text-sm font-semibold">
          Route instructions
        </summary>
        <ol className="mt-2 list-decimal space-y-3 pl-5 text-sm">
          {route.steps.map((step, index) => (
            <li key={index}>
              <p>{step.instruction}</p>
              <p className="mt-1 text-xs text-[#C7D5CB]">
                {step.distance_meters < 1000
                  ? `${Math.round(step.distance_meters)} m`
                  : `${(step.distance_meters / 1000).toFixed(1)} km`}
              </p>
            </li>
          ))}
        </ol>
      </details>
      <p className="text-[11px] text-[#C7D5CB]">
        Route information provided by Google Maps. Estimates depend on current
        conditions.
      </p>
    </div>
  );
}
