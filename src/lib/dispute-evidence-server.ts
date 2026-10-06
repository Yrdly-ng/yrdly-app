import { supabaseAdmin } from '@/lib/supabase-admin';

type EvidencePayload = Record<string, unknown> & {
  photos?: unknown;
  chatScreenshots?: unknown;
};

async function signList(values: unknown): Promise<unknown> {
  if (!Array.isArray(values)) return values;
  return Promise.all(values.map(async (value) => {
    if (typeof value !== 'string' || value.startsWith('http://') || value.startsWith('https://')) return value;
    const { data, error } = await supabaseAdmin.storage
      .from('dispute-evidence')
      .createSignedUrl(value, 60 * 60);
    return error ? null : data.signedUrl;
  }));
}

export async function signDisputeEvidence<T>(evidence: T): Promise<T> {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return evidence;
  const payload = evidence as EvidencePayload;
  const [photos, chatScreenshots] = await Promise.all([
    signList(payload.photos),
    signList(payload.chatScreenshots),
  ]);
  return { ...payload, photos, chatScreenshots } as T;
}

