import { supabaseAdmin } from './supabase-admin';

/**
 * Checks if a user is currently suspended or banned.
 */
export async function isUserSuspendedOrBanned(userId: string): Promise<{ suspended: boolean; reason?: string }> {
  if (!userId) return { suspended: false };
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('is_suspended, is_banned, status, suspension_reason')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return { suspended: false };

    const suspended = Boolean(
      data.is_suspended ||
      data.is_banned ||
      data.status === 'suspended' ||
      data.status === 'banned'
    );

    return {
      suspended,
      reason: data.suspension_reason || 'Account suspended or banned',
    };
  } catch (err) {
    console.error('Error checking user suspension state:', err);
    return { suspended: false };
  }
}
