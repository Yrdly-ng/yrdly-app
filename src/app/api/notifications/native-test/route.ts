import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { invokeServerFunction } from '@/lib/notifications/server-functions';

export const dynamic = 'force-dynamic';

// Authorized, rate-limited, single-device self-test only. This is never
// a public arbitrary-recipient notification API.
export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) {
    return NextResponse.json(
      { error: 'Sign in again to test native notifications.' },
      { status: error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401 },
    );
  }

  let deviceId: unknown;
  try {
    ({ deviceId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (typeof deviceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(deviceId)) {
    return NextResponse.json({ error: 'Invalid device ID.' }, { status: 400 });
  }

  // Device registration is owned by the bearer token's authenticated account.
  const { data: registered, error: registrationError } = await supabaseAdmin
    .from('user_push_tokens')
    .select('id')
    .eq('user_id', user.id)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (registrationError) {
    return NextResponse.json({ error: 'Could not check this device registration.' }, { status: 503 });
  }
  if (!registered) {
    return NextResponse.json(
      { error: 'This device is not registered for native notifications yet. Open YRDLY, allow notifications, and try again.' },
      { status: 409 },
    );
  }

  const { data: allowed, error: limitError } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id,
    p_endpoint: '/api/notifications/native-test',
    p_max_requests: 2,
    p_window_seconds: 60,
  });
  if (limitError) return NextResponse.json({ error: 'Please try again later.' }, { status: 503 });
  if (!allowed) return NextResponse.json({ error: 'Too many tests. Try again in a minute.' }, { status: 429 });

  const { data, error: pushError } = await invokeServerFunction(supabaseAdmin, 'send-push-notification', {
    userId: user.id,
    channel: 'native',
    targetDeviceId: deviceId,
    type: 'push_test',
    payload: {
      title: 'YRDLY mobile push test',
      body: 'This is a test notification for your installed YRDLY app.',
      data: { type: 'push_test', recipientId: user.id },
    },
  });
  const queued = typeof data?.queuedNativeDevices === 'number' ? data.queuedNativeDevices : 0;
  if (pushError || queued !== 1) {
    return NextResponse.json(
      { success: false, queued: 0, error: 'Test could not be queued for this device. Reopen YRDLY and try again.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    { success: true, queued: 1, note: 'Queued for Expo delivery; check the device notification banner.' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
