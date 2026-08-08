/**
 * Geocoding Service — Reverse-geocodes GPS coordinates into Nigerian
 * administrative units (State → LGA → Ward).
 *
 * Strategy:
 *  1. Google Maps REST Geocoding API → reliable for State + LGA in urban areas.
 *  2. Check against canonical lga_wards using normalized string matching.
 *  3. Find the nearest ward within the matched State+LGA via haversine distance.
 *  4. If unmatched or outside Nigeria, return explicit status.
 *
 * NOTE (Optimization): Fetching 8,800 rows client-side is a heavy payload.
 * A server-side PostGIS RPC (`resolve_location`) is planned as a 
 * post-submission optimization to handle normalization and distance matching.
 */

import { supabase } from '@/lib/supabase';

export interface ResolvedLocation {
  state: string;
  lga: string;
  ward: string;
  displayAddress: string;
  lat: number;
  lng: number;
}

export const OUTSIDE_NIGERIA = "outside_nigeria";
export const UNMATCHED_LOCATION = "unmatched_location";

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let lgaWardsCache: any[] = [];

async function getLgaWards(supabase: any): Promise<any[]> {
  if (lgaWardsCache.length > 0) return lgaWardsCache;
  const { data, error } = await supabase.from('lga_wards').select('state, lga, ward, latitude, longitude');
  if (error || !data) {
    console.error('Failed to fetch lga_wards', error);
    return [];
  }
  lgaWardsCache = data || [];
  return lgaWardsCache;
}

async function matchLocationAgainstDatabase(
  supabase: any,
  lat: number,
  lng: number
): Promise<{ state: string; lga: string; ward: string } | null> {
  const wards = await getLgaWards(supabase);
  if (!wards.length) return null;

  // Find closest ward via Haversine nationwide
  let bestWard = wards[0];
  let bestDist = Infinity;

  for (const w of wards) {
    if (w.latitude != null && w.longitude != null) {
      const d = haversine(lat, lng, Number(w.latitude), Number(w.longitude));
      if (d < bestDist) {
        bestDist = d;
        bestWard = w;
      }
    }
  }

  // Only return unmatched if the closest ward is unreasonably far (e.g., > 50km)
  if (bestDist > 50) return null;

  return {
    state: bestWard.state,
    lga: bestWard.lga,
    ward: bestWard.ward,
  };
}

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ResolvedLocation | { status: typeof OUTSIDE_NIGERIA | typeof UNMATCHED_LOCATION }> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  let googleState = "";
  let googleLga = "";
  let displayAddress = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  if (apiKey) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=en`,
      );
      const data = await res.json();

      if (data.status === "OK" && data.results?.length > 0) {
        displayAddress = data.results[0].formatted_address || displayAddress;
        
        let country = "";

        for (const result of data.results) {
          for (const comp of result.address_components || []) {
            if (comp.types.includes("country") && !country) {
              country = comp.long_name;
            }
            if (
              comp.types.includes("administrative_area_level_1") &&
              !googleState
            ) {
              googleState = comp.long_name;
            }
            if (
              comp.types.includes("administrative_area_level_2") &&
              !googleLga
            ) {
              googleLga = comp.long_name;
            }
          }
        }
        
        if (!country || country !== "Nigeria") {
          return { status: OUTSIDE_NIGERIA };
        }
      }
    } catch {
      // Google API failed — fail normally below due to unmatched
    }
  }

  const matched = await matchLocationAgainstDatabase(supabase, lat, lng);
  if (!matched) return { status: UNMATCHED_LOCATION };

  return {
    state: matched.state,
    lga: matched.lga,
    ward: matched.ward,
    displayAddress,
    lat,
    lng,
  };
}
