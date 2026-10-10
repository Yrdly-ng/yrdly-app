import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const publicBuckets = new Set(['post-images', 'event-images', 'business-images', 'catalog-images', 'avatars', 'profile-images']);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
function namedKeys(name: string): string[] {
  try { return Object.values(JSON.parse(Deno.env.get(name) || '{}')).filter((v): v is string => typeof v === 'string'); } catch { return []; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const secrets = namedKeys('SUPABASE_SECRET_KEYS').filter(v => v.startsWith('sb_secret_'));
    const apiKey = req.headers.get('apikey');
    const backendKey = apiKey && secrets.includes(apiKey) ? apiKey
      : legacy && req.headers.get('authorization') === 'Bearer ' + legacy ? legacy : null;
    let userId: string | undefined;
    if (!backendKey) {
      const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      if (!token) return reply({ error: 'Unauthorized' }, 401);
      const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || namedKeys('SUPABASE_PUBLISHABLE_KEYS')[0] || '');
      const { data, error } = await auth.auth.getUser(token);
      if (error || !data.user) return reply({ error: 'Unauthorized' }, 401);
      userId = data.user.id;
    }
    const reader = req.body?.getReader();
    if (!reader) return reply({ error: 'Missing body' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); return reply({ error: 'Payload too large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let input;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    const { type, content, bucket } = input || {};
    if (!['text', 'image'].includes(type) || !(typeof content === 'string' || (Array.isArray(content) && content.length <= 10 && content.every(v => typeof v === 'string')))) return reply({ error: 'Invalid content' }, 400);
    const admin = createClient(url, backendKey || legacy || secrets[0] || '');
    if (userId) {
      const { data: allowed, error } = await admin.rpc('consume_rate_limit', { p_user_id: userId, p_endpoint: 'moderate-content', p_max_requests: 30, p_window_seconds: 60 });
      if (error) return reply({ error: 'Moderation unavailable' }, 503);
      if (!allowed) return reply({ error: 'Too many requests' }, 429);
    }
    const apiUser = Deno.env.get('SIGHTENGINE_API_USER');
    const apiSecret = Deno.env.get('SIGHTENGINE_API_SECRET');
    if (!apiUser || !apiSecret) return reply({ error: 'Moderation unavailable' }, 503);
    if (type === 'text') {
      const text = Array.isArray(content) ? content.join(' ') : content;
      if (!text.trim()) return reply({ isSafe: true });
      const form = new FormData();
      for (const [key, value] of Object.entries({ text, lang: 'en', mode: 'rules', api_user: apiUser, api_secret: apiSecret })) form.append(key, value);
      const response = await fetch('https://api.sightengine.com/1.0/text/check.json', { method: 'POST', body: form, signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok || result.status !== 'success') return reply({ isSafe: false, reason: 'moderation_error' });
      return reply({ isSafe: !result.profanity?.matches?.length, ...(result.profanity?.matches?.length ? { reason: 'inappropriate_language' } : {}) });
    }
    const target = bucket || 'post-images';
    if (!publicBuckets.has(target)) return reply({ error: 'Invalid target bucket' }, 400);
    const paths = Array.isArray(content) ? content : [content];
    const finalUrls = [];
    for (const path of paths) {
      let source = 'pending-moderation', objectPath = path;
      if (/^https?:\/\//i.test(path)) {
        const parsed = new URL(path);
        const host = new URL(url).hostname;
        if (parsed.protocol !== 'https:' || ![host, ...(host === 'yoiyqxtpmxnrrbqqidcs.supabase.co' ? ['api.yrdly.ng'] : [])].includes(parsed.hostname)) return reply({ error: 'Invalid storage host' }, 400);
        const match = parsed.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
        if (!match || parsed.search || parsed.hash) return reply({ error: 'Only public storage URLs are accepted' }, 400);
        source = match[1]; objectPath = decodeURIComponent(match[2]);
      }
      if (!objectPath || /[\\?#\x00-\x1f]/.test(objectPath) || objectPath.split('/').some(v => !v || v === '.' || v === '..' || /%2e|%2f|%5c/i.test(v))) return reply({ error: 'Invalid storage path' }, 400);
      const owner = userId || (backendKey && typeof input.userId === 'string' && /^[0-9a-f-]{36}$/i.test(input.userId) ? input.userId : null);
      const ownPending = source === 'pending-moderation' && owner && objectPath.startsWith(owner + '/');
      if (!publicBuckets.has(source) && !ownPending) return reply({ error: 'Forbidden storage source' }, 403);
      const { data: signed, error: signError } = await admin.storage.from(source).createSignedUrl(objectPath, 60);
      if (signError || !signed?.signedUrl) return reply({ isSafe: false, reason: 'moderation_error' });
      const query = new URLSearchParams({ models: 'nudity-2.0,gore,wad,offensive', api_user: apiUser, api_secret: apiSecret, url: signed.signedUrl });
      const response = await fetch('https://api.sightengine.com/1.0/check.json?' + query, { signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok || result.status !== 'success') return reply({ isSafe: false, reason: 'moderation_error' });
      const unsafe = [result.nudity?.sexual_activity, result.nudity?.sexual_display, result.nudity?.erotica, result.gore?.prob, result.wad?.weapon, result.wad?.drugs, result.offensive?.prob].some(v => typeof v === 'number' && v > 0.5);
      if (unsafe) {
        if (ownPending) {
          const quarantinePath = owner + '/' + Date.now() + '_' + objectPath.replaceAll('/', '_');
          const copied = await admin.storage.from(source).copy(objectPath, quarantinePath, { destinationBucket: 'quarantine' });
          if (!copied.error) await admin.storage.from(source).remove([objectPath]);
        }
        return reply({ isSafe: false, reason: 'inappropriate_image' });
      }
      if (ownPending) {
        const copied = await admin.storage.from(source).copy(objectPath, objectPath, { destinationBucket: target });
        if (copied.error) return reply({ isSafe: false, reason: 'moderation_error' });
        await admin.storage.from(source).remove([objectPath]);
      }
      finalUrls.push(admin.storage.from(ownPending ? target : source).getPublicUrl(objectPath).data.publicUrl);
    }
    return reply({ isSafe: true, urls: finalUrls });
  } catch {
    console.error('Moderation request failed');
    return reply({ error: 'Moderation unavailable' }, 503);
  }
});

