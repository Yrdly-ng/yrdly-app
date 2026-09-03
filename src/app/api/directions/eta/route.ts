import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// ── Rate limiting ────────────────────────────────────────────────────────────
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const ENDPOINT = '/api/directions/eta';

// ── Types ────────────────────────────────────────────────────────────────────
interface Coordinate {
  lat: number;
  lng: number;
}

interface ETAResponse {
  duration_seconds: number;
  duration_in_traffic_seconds: number;
  distance_meters: number;
}

// Google Directions API statuses that are the caller's fault
const CLIENT_ERROR_STATUSES = new Set([
  'ZERO_RESULTS',
  'NOT_FOUND',
  'MAX_WAYPOINTS_EXCEEDED',
  'INVALID_REQUEST',
]);

export async function POST(request: NextRequest) {
  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Rate limiting ──────────────────────────────────────────────────────────
    // Note: We intentionally write user.id into the 'ip_address' column here 
    // because the rate_limits table lacks a user_id column. This is safe and 
    // will not collide with IP-keyed rows from other routes because the query 
    // is scoped by the 'endpoint' column.
    const now = new Date();
    const { data: rlData } = await supabaseAdmin
      .from('rate_limits')
      .select('*')
      .eq('ip_address', user.id)
      .eq('endpoint', ENDPOINT)
      .single();

    if (rlData) {
      const windowStart = new Date(rlData.window_start).getTime();
      if (now.getTime() - windowStart < RATE_LIMIT_WINDOW_MS) {
        if (rlData.request_count >= RATE_LIMIT_MAX) {
          return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }
        await supabaseAdmin
          .from('rate_limits')
          .update({ request_count: rlData.request_count + 1 })
          .eq('ip_address', user.id)
          .eq('endpoint', ENDPOINT);
      } else {
        await supabaseAdmin
          .from('rate_limits')
          .update({ request_count: 1, window_start: now.toISOString() })
          .eq('ip_address', user.id)
          .eq('endpoint', ENDPOINT);
      }
    } else {
      await supabaseAdmin.from('rate_limits').insert({
        ip_address: user.id,
        endpoint: ENDPOINT,
        request_count: 1,
        window_start: now.toISOString(),
      });
    }

    // ── Input validation ─────────────────────────────────────────────────────
    let body: { origin?: Coordinate; destination?: Coordinate };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { origin, destination } = body;
    if (
      !origin || !destination ||
      typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ||
      typeof destination.lat !== 'number' || typeof destination.lng !== 'number'
    ) {
      return NextResponse.json(
        { error: 'origin and destination must each have numeric lat and lng fields' },
        { status: 400 }
      );
    }

    // ── Google Directions API call ────────────────────────────────────────────
    const apiKey = process.env.GOOGLE_DIRECTIONS_API_KEY;
    if (!apiKey) {
      console.error('[ETA] GOOGLE_DIRECTIONS_API_KEY is not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const params = new URLSearchParams({
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      departure_time: 'now',
      traffic_model: 'best_guess',
      key: apiKey,
    });

    const googleRes = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
      { cache: 'no-store' } // traffic data must be fresh
    );

    if (!googleRes.ok) {
      console.error(`[ETA] Google API HTTP error: ${googleRes.status}`);
      return NextResponse.json({ error: 'Upstream error from Google' }, { status: 502 });
    }

    const googleData = await googleRes.json();
    const status: string = googleData.status;

    if (status !== 'OK') {
      if (CLIENT_ERROR_STATUSES.has(status)) {
        return NextResponse.json({ error: `Could not calculate route: ${status}` }, { status: 400 });
      }
      if (status === 'REQUEST_DENIED') {
        console.error('[ETA] Google REQUEST_DENIED — check API key restrictions and billing');
        return NextResponse.json({ error: 'Route calculation unavailable' }, { status: 503 });
      }
      console.error(`[ETA] Google API returned status: ${status}`);
      return NextResponse.json({ error: 'Route calculation failed' }, { status: 502 });
    }

    // ── Parse only the fields the client needs ────────────────────────────────
    const leg = googleData.routes?.[0]?.legs?.[0];
    if (!leg) {
      return NextResponse.json({ error: 'No route found' }, { status: 404 });
    }

    const result: ETAResponse = {
      duration_seconds: leg.duration?.value ?? 0,
      duration_in_traffic_seconds: leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0,
      distance_meters: leg.distance?.value ?? 0,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('[ETA] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
