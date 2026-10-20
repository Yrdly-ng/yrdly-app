export type DirectionsMode = "driving" | "walking";
export interface DirectionsPoint {
  lat: number;
  lng: number;
}
export interface DirectionsTarget {
  type: "marketplace" | "event" | "legacy-event" | "business";
  id: string;
}
export interface DirectionsDestination
  extends DirectionsTarget, DirectionsPoint {
  title: string;
  address: string;
  approximate: boolean;
  image?: string;
  href: string;
}
export interface DirectionsStep {
  instruction: string;
  distance_meters: number;
  duration_seconds: number;
}
export interface DirectionsRoute {
  destination: DirectionsDestination;
  mode: DirectionsMode;
  overview_polyline: string;
  distance_meters: number;
  duration_seconds: number;
  steps: DirectionsStep[];
  warnings: string[];
}
