import { supabase } from './supabase';
export async function requireAdmin(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  // check is_admin or app_metadata.role
  const role = (user.app_metadata as any)?.role;
  if (role === 'admin') return true;
  const { data } = await supabase.from('users').select('is_admin, role').eq('id', user.id).single();
  return Boolean((data as any)?.is_admin === true || (data as any)?.role === 'admin');
}
