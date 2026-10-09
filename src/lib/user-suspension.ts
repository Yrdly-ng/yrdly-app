import { supabaseAdmin } from './supabase-admin';

export async function isUserSuspendedOrBanned(userId: string): Promise<{ suspended: boolean; reason?: string }> {
  if (!userId) throw new Error('User ID required');
  const { data, error } = await supabaseAdmin.from('users')
    .select('is_suspended,is_banned,status,suspension_reason').eq('id', userId).maybeSingle();
  if (error || !data) throw new Error('Account status could not be verified');
  return { suspended: !!(data.is_suspended || data.is_banned || ['suspended','banned'].includes(data.status)), reason: data.suspension_reason || undefined };
}
