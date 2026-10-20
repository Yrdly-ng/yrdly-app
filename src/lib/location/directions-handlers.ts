import "server-only";
import { createClient as createJsClient } from "@supabase/supabase-js";
import {
  createClient,
  getAuthenticatedUser,
} from "../supabase/supabase-server";
import { brandedSupabaseUrl } from "../supabase/supabase-url";
import { supabaseAdmin } from "../supabase/supabase-admin";
import { createDirectionsHandlers } from "./directions-service";

export const directionsHandlers = createDirectionsHandlers({
  async authenticate(request) {
    const {
      data: { user },
      error,
    } = await getAuthenticatedUser(request);
    if (error || !user)
      return {
        errorStatus:
          error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401,
      };
    const authorization = request.headers.get("authorization");
    const client = authorization?.startsWith("Bearer ")
      ? createJsClient(
          brandedSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            auth: { persistSession: false, autoRefreshToken: false },
            global: {
              headers: { Authorization: authorization },
              fetch: (input, init) =>
                fetch(input, {
                  ...init,
                  signal: AbortSignal.any([
                    request.signal,
                    AbortSignal.timeout(5000),
                  ]),
                }),
            },
          },
        )
      : await createClient();
    return { userId: user.id, client };
  },
  async consumeLimit(userId, endpoint) {
    const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
      p_user_id: userId,
      p_endpoint: endpoint,
      p_max_requests: 30,
      p_window_seconds: 60,
    });
    if (error) throw new Error("Directions rate limit unavailable");
    return data === true;
  },
  fetch: (...args) => fetch(...args),
  directionsKey: process.env.GOOGLE_DIRECTIONS_API_KEY,
  geocodeKey: process.env.GOOGLE_MAPS_SERVER_API_KEY,
});
