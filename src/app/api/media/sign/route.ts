import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PRIVATE_MEDIA_BUCKETS, mediaConversationId, validatePrivateMediaPath } from '@/lib/private-media';

const response = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization' },
});

export async function POST(request: Request) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return response({ error: 'Please sign in again.' }, error?.status || 401);
  let bucket: string;
  let path: string;
  try {
    const input = await request.json();
    if (!PRIVATE_MEDIA_BUCKETS.includes(input.bucket) || typeof input.path !== 'string') throw new Error('Invalid media reference');
    bucket = input.bucket;
    path = validatePrivateMediaPath(input.path);
  } catch { return response({ error: 'Invalid media reference' }, 400); }

  try {
    const { data: allowed, error: limiterError } = await supabaseAdmin.rpc('consume_rate_limit', {
      p_user_id: user.id, p_endpoint: '/api/media/sign', p_max_requests: 180, p_window_seconds: 60,
    });
    if (limiterError) return response({ error: 'Media access unavailable' }, 503);
    if (!allowed) return response({ error: 'Too many media requests' }, 429);
    if (bucket === 'reports') {
      if (path.split('/')[0] !== user.id) {
        const { data, error: adminError } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (adminError) return response({ error: 'Media access unavailable' }, 503);
        if (!data?.is_admin) return response({ error: 'Media unavailable' }, 403);
      }
    } else {
      const conversationId = mediaConversationId(path);
      if (!conversationId) return response({ error: 'Invalid conversation media path' }, 400);
      const { data, error: memberError } = await supabaseAdmin.from('conversations')
        .select('id').eq('id', conversationId).contains('participant_ids', [user.id]).maybeSingle();
      if (memberError) return response({ error: 'Media access unavailable' }, 503);
      if (!data) return response({ error: 'Media unavailable' }, 403);
    }
    const { data, error: signingError } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 300);
    if (signingError || !data?.signedUrl) return response({ error: 'Media unavailable' }, 404);
    return response({ url: data.signedUrl, expiresAt: Date.now() + 300_000 });
  } catch {
    console.error('Private media authorization/signing failed');
    return response({ error: 'Media access unavailable' }, 503);
  }
}
