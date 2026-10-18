import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2';
import { processCommunityJob, type CommunityJob, type CommunityJobPorts } from './processor.ts';

function backendKey(req: Request): string | null {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  let keys: string[] = [];
  try {
    keys = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'));
  } catch {}
  const key = req.headers.get('apikey');
  return key && (key === legacy || keys.includes(key))
    ? key
    : legacy && req.headers.get('authorization') === `Bearer ${legacy}`
      ? legacy
      : null;
}
serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const key = backendKey(req);
  if (!key) return new Response('Unauthorized', { status: 401 });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const serviceHeaders = {
    'Content-Type': 'application/json',
    apikey: key,
    ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}),
  };
  const unwrap = async <T>(query: PromiseLike<{ data: T; error: any }>): Promise<T> => {
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const ports: CommunityJobPorts = {
    loadReview: (id) =>
      unwrap(admin.from('community_content_reviews').select('*').eq('id', id).maybeSingle()),
    member: (cid, uid) =>
      unwrap(
        admin
          .from('community_memberships')
          .select('status,is_muted')
          .eq('community_id', cid)
          .eq('user_id', uid)
          .maybeSingle()
      ),
    community: (id) =>
      unwrap(admin.from('communities').select('name,approval_status').eq('id', id).maybeSingle()),
    checkText: async (text) => {
      if (!text.trim()) return { isSafe: true };
      const response = await fetch(`${url}/functions/v1/moderate-content`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ type: 'text', content: text }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Text moderation unavailable');
      const verdict = await response.json();
      if (typeof verdict.isSafe !== 'boolean') throw new Error('Invalid moderation response');
      return verdict;
    },
    checkImages: async (references) => {
      for (const reference of references) {
        const prefix = 'storage://community-media/';
        // Old public attachments are never fetched by the worker. They need manual review.
        if (!reference.startsWith(prefix))
          return { isSafe: false, reason: 'Image needs a moderator’s review' };
        const signed = await unwrap(
          admin.storage.from('community-media').createSignedUrl(reference.slice(prefix.length), 120)
        );
        const apiUser = Deno.env.get('SIGHTENGINE_API_USER');
        const apiSecret = Deno.env.get('SIGHTENGINE_API_SECRET');
        if (!apiUser || !apiSecret) throw new Error('Image moderation unavailable');
        const query = new URLSearchParams({
          models: 'nudity-2.0,gore,wad,offensive',
          api_user: apiUser,
          api_secret: apiSecret,
          url: signed.signedUrl,
        });
        const response = await fetch('https://api.sightengine.com/1.0/check.json?' + query, {
          signal: AbortSignal.timeout(15000),
        });
        const result = await response.json();
        if (!response.ok || result.status !== 'success')
          throw new Error('Image moderation unavailable');
        if (
          [
            result.nudity?.sexual_activity,
            result.nudity?.sexual_display,
            result.nudity?.erotica,
            result.gore?.prob,
            result.wad?.weapon,
            result.wad?.drugs,
            result.offensive?.prob,
          ].some((value) => typeof value === 'number' && value > 0.5)
        )
          return { isSafe: false, reason: 'Image flagged for review' };
      }
      return { isSafe: true };
    },
    approve: async (id) => {
      await unwrap(
        admin.rpc('community_review_content', { p_review_id: id, p_decision: 'approved' })
      );
    },
    note: async (id, reason) => {
      await unwrap(
        admin
          .from('community_content_reviews')
          .update({ reason })
          .eq('id', id)
          .eq('status', 'pending')
      );
    },
    saveNotification: async (notification) => {
      await unwrap(
        admin
          .from('notifications')
          .upsert(notification, { onConflict: 'id', ignoreDuplicates: true })
      );
    },
    sendNotification: async (notification) => {
      const response = await fetch(`${url}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          userId: notification.user_id,
          type: 'community_update',
          payload: {
            title: notification.title,
            body: notification.message,
            url: notification.data.url,
            data: notification.data,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Push enqueue unavailable');
    },
  };
  try {
    const jobs = (await unwrap(
      admin.rpc('claim_community_jobs', { p_limit: 3 })
    )) as CommunityJob[];
    let processed = 0;
    await Promise.all(
      (jobs || []).map(async (job) => {
        try {
          const result = await processCommunityJob(job, ports);
          await unwrap(
            admin
              .from('community_jobs')
              .update({
                status:
                  result.status === 'retry'
                    ? 'queued'
                    : result.status === 'manual'
                      ? 'failed'
                      : 'done',
                last_error: result.error || null,
                next_attempt_at: new Date(
                  Date.now() + 60_000 * 2 ** job.attempt_count
                ).toISOString(),
              })
              .eq('id', job.id)
          );
          processed++;
        } catch {
          await admin
            .from('community_jobs')
            .update({
              status: job.attempt_count >= 3 ? 'failed' : 'queued',
              last_error: 'Worker could not complete job',
              next_attempt_at: new Date(Date.now() + 300_000).toISOString(),
            })
            .eq('id', job.id);
        }
      })
    );
    return Response.json({ processed });
  } catch {
    return Response.json({ error: 'Community processing unavailable' }, { status: 503 });
  }
});
