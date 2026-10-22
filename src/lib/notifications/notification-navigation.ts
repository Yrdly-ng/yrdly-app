import { supabase } from "@/lib/supabase/supabase";
import { resolveNotificationNavigation } from "./notification-routing";

/** All lookups use the current user's session and database access policies. */
export function prepareNotificationNavigation(input: Record<string, any>) {
  return resolveNotificationNavigation(input, async (table, id) => {
    if (table === 'payout_requests') {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return { found: false, error: new Error('Please sign in again.') };
        const response = await fetch(`/api/seller/payouts/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
        });
        if (response.status === 403 || response.status === 404) return { found: false };
        if (!response.ok) return { found: false, error: new Error('Receipt unavailable') };
        const result = await response.json();
        return { found: result.payout?.id === id };
      } catch (error) { return { found: false, error }; }
    }
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .maybeSingle();
    return { found: !!data, error };
  });
}
