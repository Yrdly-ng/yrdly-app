import { supabase } from "@/lib/supabase/supabase";
import { resolveNotificationNavigation } from "./notification-routing";

/** All lookups use the current user's session and database access policies. */
export function prepareNotificationNavigation(input: Record<string, any>) {
  return resolveNotificationNavigation(input, async (table, id) => {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .maybeSingle();
    return { found: !!data, error };
  });
}
