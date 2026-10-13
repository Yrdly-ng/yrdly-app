import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
export const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function namedKey(name: string): string {
  try { return Object.values(JSON.parse(Deno.env.get(name) || '{}')).find((v): v is string => typeof v === 'string') || ''; } catch { return ''; }
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 30) return null;
  let phone = value.trim().replace(/[ ()-]/g, '').replace(/^\+/, '');
  if (/^0[789]\d{9}$/.test(phone)) phone = '234' + phone.slice(1);
  return /^234[789]\d{9}$/.test(phone) ? phone : null;
}

export async function authorize(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { error: reply({ error: 'Unauthorized' }, 401) };
  const url = Deno.env.get('SUPABASE_URL') || '';
  const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || namedKey('SUPABASE_PUBLISHABLE_KEYS'), { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return { error: reply({ error: 'Unauthorized' }, 401) };
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || namedKey('SUPABASE_SECRET_KEYS'), { auth: { persistSession: false } });
  const profile = await admin.from('users').select('is_suspended,is_banned,status').eq('id', data.user.id).maybeSingle();
  if (profile.error || !profile.data) return { error: reply({ error: 'Account unavailable' }, 503) };
  if (profile.data.is_suspended || profile.data.is_banned || ['suspended', 'banned'].includes(profile.data.status)) return { error: reply({ error: 'Account suspended' }, 403) };
  return { admin, userId: data.user.id };
}

export async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Invalid body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) { await reader.cancel(); throw new Error('Invalid body'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
  return body;
}

export async function rateLimit(admin: ReturnType<typeof createClient>, userId: string, endpoint: string, max: number, seconds: number) {
  const result = await admin.rpc('consume_rate_limit', { p_user_id: userId, p_endpoint: endpoint, p_max_requests: max, p_window_seconds: seconds });
  if (result.error) return reply({ error: 'Verification unavailable' }, 503);
  return result.data === true ? null : reply({ error: 'Too many requests. Please try again later.' }, 429);
}

export async function termii(path: string, payload: Record<string, unknown>) {
  const key = Deno.env.get('TERMII_API_KEY');
  if (!key) throw new Error('Provider unavailable');
  const base = Deno.env.get('TERMII_BASE_URL') || 'https://v4.api.termii.com';
  const response = await fetch(`${base}/api/sms/otp/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, api_key: key }), signal: AbortSignal.timeout(10000), redirect: 'error' });
  const data = await response.json();
  if (!response.ok) throw new Error('Provider unavailable');
  return data;
}

export function preflight(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  return null;
}
