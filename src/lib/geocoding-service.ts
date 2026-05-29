/**
 * Geocoding Service — Reverse-geocodes GPS coordinates into Nigerian
 * administrative units (State → LGA → Ward).
 *
 * Strategy:
 *  1. Google Maps REST Geocoding API → reliable for State + LGA in urban areas.
 *  2. Ward: Google never returns ward data for Nigeria, so we use the local
 *     wards.json dataset (8,800+ entries with lat/lng) and find the nearest
 *     ward via haversine distance within the matched State+LGA.
 *  3. If Google can't resolve an LGA we fall back to the nearest LGA from
 *     the wards dataset.
 */

// ── Types ───────────────────────────────────────────────────────

export interface ResolvedLocation {
  state: string;
  lga: string;
  ward: string;
  displayAddress: string;
  lat: number;
  lng: number;
}

interface WardEntry {
  State: string;
  LGA: string;
  Ward: string;
  Latitude: number;
  Longitude: number;
}

// ── Haversine helper (km) ───────────────────────────────────────

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

// ── Normalisation helper ────────────────────────────────────────
// Google might return "Eti-Osa Local Government Area" while our dataset has
// "Eti-Osa". Strip suffixes and normalise whitespace/hyphens for matching.

function normaliseName(name: string): string {
  return name
    .replace(/ Local Government Area$/i, "")
    .replace(/ LGA$/i, "")
    .replace(/ State$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[- ]+/g, ""); // "Eti-Osa" & "Eti Osa" → "etiosa"
}

// ── Lazy-loaded wards dataset ───────────────────────────────────

let wardsCache: WardEntry[] | null = null;

async function getWards(): Promise<WardEntry[]> {
  if (wardsCache) return wardsCache;
  const mod = await import("@/data/wards.json");
  wardsCache = mod.default as WardEntry[];
  return wardsCache;
}

// ── Find nearest ward from the local dataset ────────────────────

async function findNearestWard(
  lat: number,
  lng: number,
  state?: string,
  lga?: string,
): Promise<{ state: string; lga: string; ward: string; distance: number }> {
  const wards = await getWards();

  // Start with the tightest possible scope
  let candidates = wards;
  if (state && lga) {
    const ns = normaliseName(state);
    const nl = normaliseName(lga);
    const filtered = wards.filter(
      (w) => normaliseName(w.State) === ns && normaliseName(w.LGA) === nl,
    );
    if (filtered.length > 0) candidates = filtered;
  }
  if (candidates === wards && state) {
    const ns = normaliseName(state);
    const filtered = wards.filter((w) => normaliseName(w.State) === ns);
    if (filtered.length > 0) candidates = filtered;
  }

  let best = candidates[0];
  let bestDist = Infinity;

  for (const w of candidates) {
    const d = haversine(lat, lng, w.Latitude, w.Longitude);
    if (d < bestDist) {
      bestDist = d;
      best = w;
    }
  }

  return { state: best.State, lga: best.LGA, ward: best.Ward, distance: bestDist };
}

// ── LGA fuzzy match against our dataset ─────────────────────────
// Google might return "Eti-Osa" but our lgas.json has "Eti Osa" (or vice
// versa). We try to find the canonical form.

let lgasCache: Record<string, string[]> | null = null;

async function getLgas(): Promise<Record<string, string[]>> {
  if (lgasCache) return lgasCache;
  const mod = await import("@/data/lgas.json");
  lgasCache = mod.default as Record<string, string[]>;
  return lgasCache;
}

async function matchLga(state: string, googleLga: string): Promise<string> {
  const lgas = await getLgas();
  const stateKey = Object.keys(lgas).find(
    (k) => normaliseName(k) === normaliseName(state),
  );
  if (!stateKey) return googleLga; // can't match state, return Google's answer

  const stateLgas = lgas[stateKey];
  // Exact match first
  const exact = stateLgas.find((l) => l === googleLga);
  if (exact) return exact;
  // Normalised match
  const norm = normaliseName(googleLga);
  const fuzzy = stateLgas.find((l) => normaliseName(l) === norm);
  return fuzzy || googleLga;
}

async function matchState(googleState: string): Promise<string> {
  const lgas = await getLgas();
  const stateKey = Object.keys(lgas).find(
    (k) => normaliseName(k) === normaliseName(googleState),
  );
  return stateKey || googleState;
}

// ── Public: reverse-geocode coordinates ─────────────────────────

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ResolvedLocation> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  let googleState = "";
  let googleLga = "";
  let displayAddress = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  // Step 1 — Google REST Geocoding API
  if (apiKey) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=en`,
      );
      const data = await res.json();

      if (data.status === "OK" && data.results?.length > 0) {
        displayAddress = data.results[0].formatted_address || displayAddress;

        for (const result of data.results) {
          for (const comp of result.address_components || []) {
            if (
              comp.types.includes("administrative_area_level_1") &&
              !googleState
            ) {
              googleState = comp.long_name
                .replace(/ State$/i, "")
                .trim();
            }
            if (
              comp.types.includes("administrative_area_level_2") &&
              !googleLga
            ) {
              googleLga = comp.long_name
                .replace(/ Local Government Area$/i, "")
                .replace(/ LGA$/i, "")
                .trim();
            }
          }
        }
      }
    } catch {
      // Google API failed — fall through to dataset fallback
    }
  }

  // Step 2 — Normalise against our canonical dataset
  if (googleState) {
    googleState = await matchState(googleState);
  }
  if (googleState && googleLga) {
    googleLga = await matchLga(googleState, googleLga);
  }

  // Step 3 — Ward lookup (always from our dataset)
  const nearest = await findNearestWard(lat, lng, googleState, googleLga);

  // If Google couldn't resolve state or LGA, use the dataset's answer
  const finalState = googleState || nearest.state;
  const finalLga = googleLga || nearest.lga;
  const finalWard = nearest.ward;

  return {
    state: finalState,
    lga: finalLga,
    ward: finalWard,
    displayAddress,
    lat,
    lng,
  };
}
