import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { buildMapsRequest, MapsInputError } from '@/lib/location/maps-proxy';

function failure(message: string, status: number) {
  return NextResponse.json(
    { status: 'REQUEST_DENIED', error_message: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { data: { user }, error } = await getAuthenticatedUser(request);
    if (!user || error) {
      return failure('Please sign in to search addresses', error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401);
    }

    const { path } = await context.params;
    const url = buildMapsRequest(path, request.nextUrl.searchParams);
    const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    if (!key) return failure('Address search is temporarily unavailable', 503);

    const { data: allowed, error: limitError } = await supabaseAdmin.rpc('consume_rate_limit', {
      p_user_id: user.id, p_endpoint: '/api/maps', p_max_requests: 60, p_window_seconds: 60,
    });
    if (limitError) return failure('Address search is temporarily unavailable', 503);
    if (allowed !== true) return failure('Too many address searches. Please try again shortly.', 429);

    url.searchParams.set('key', key);
    const response = await fetch(url, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return failure('Address search is temporarily unavailable', 502);
    const data = await response.json();
    if (!['OK', 'ZERO_RESULTS'].includes(data.status)) {
      // Do not expose provider messages, credential-bearing URLs or raw errors.
      return failure('Address search is temporarily unavailable', 503);
    }

    const body = path[0] === 'geocode'
      ? { status: data.status, results: Array.isArray(data.results) ? data.results.slice(0, 10) : [] }
      : path[1] === 'autocomplete'
        ? { status: data.status, predictions: Array.isArray(data.predictions) ? data.predictions.slice(0, 10) : [] }
        : { status: data.status, result: data.result ?? null };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MapsInputError) return failure(error.message, 400);
    console.error('[Maps] Address request failed');
    return failure('Address search is temporarily unavailable', 503);
  }
}
