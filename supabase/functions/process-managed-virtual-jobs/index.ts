import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2';

// This worker only executes administrator-reviewed scheduled drafts. It cannot
// generate content, impersonate a user session, or choose arbitrary write targets.
function backendKey(request: Request): string | null {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  let secrets: string[] = [];
  try {
    secrets = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'));
  } catch {
    return null;
  }
  const key = request.headers.get('apikey');
  if (key && (key === legacy || secrets.includes(key))) return key;
  return legacy && request.headers.get('authorization') === `Bearer ${legacy}` ? legacy : null;
}

serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const key = backendKey(request);
  if (!key) return new Response('Unauthorized', { status: 401 });
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) return Response.json({ error: 'Worker configuration unavailable' }, { status: 503 });
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
  });
  const { data: jobs, error } = await client.rpc('claim_managed_virtual_jobs', { p_limit: 5 });
  if (error) return Response.json({ error: 'Could not claim managed activity' }, { status: 503 });
  let executed = 0;
  let rejected = 0;
  let uncertain = 0;
  // Bounded sequential execution avoids pressure on the global quota lock.
  for (const job of jobs || []) {
    try {
      const result = await client.rpc('execute_managed_virtual_job', {
        p_job_id: job.id,
        p_lease_token: job.lease_token,
      });
      if (result.error) uncertain++;
      else if (result.data?.status === 'done') executed++;
      else rejected++;
    } catch {
      // Leave the lease intact: the database retries at most three claims and
      // idempotently returns any committed result after an HTTP timeout.
      uncertain++;
    }
  }
  return Response.json({ claimed: jobs?.length || 0, executed, rejected, uncertain });
});
