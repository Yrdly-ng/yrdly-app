export const dynamic = "force-dynamic";

// Keep server-only Supabase admin configuration out of build-time route evaluation.
export async function POST(request: Request) {
  const { directionsHandlers } = await import("@/lib/location/directions-handlers");
  return directionsHandlers.route(request);
}
