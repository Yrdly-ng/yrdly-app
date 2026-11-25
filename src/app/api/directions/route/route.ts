export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { directionsHandlers } = await import("@/lib/location/directions-handlers");
  return directionsHandlers.route(request);
}
