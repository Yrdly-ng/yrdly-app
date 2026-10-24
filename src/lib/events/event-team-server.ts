import "server-only";
import { NextResponse } from "next/server";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  createClient,
  getAuthenticatedUser,
} from "@/lib/supabase/supabase-server";
import { brandedSupabaseUrl } from "@/lib/supabase/supabase-url";

export const eventTeamUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Preserve the caller's JWT for SQL auth.uid(); never use the service-role client. */
export async function withEventTeamRequest(
  request: Request,
  operation: (client: SupabaseClient) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const {
      data: { user },
      error,
    } = await getAuthenticatedUser(request);
    if (error || !user) {
      return NextResponse.json(
        { error: "Invalid session" },
        {
          status:
            error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401,
        },
      );
    }
    const authorization = request.headers.get("authorization");
    const client = authorization?.startsWith("Bearer ")
      ? createSupabaseClient(
          brandedSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: { headers: { Authorization: authorization } },
            auth: { persistSession: false, autoRefreshToken: false },
          },
        )
      : await createClient();
    const response = await operation(client);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    console.error("[Event team] Request failed:", error);
    return NextResponse.json(
      { error: "Unable to load event access. Please try again." },
      { status: 500 },
    );
  }
}

export async function eventTeamRpc(
  client: SupabaseClient,
  name: string,
  args?: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    console.error('[Event team] RPC failed', {
      function: name,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    const statuses: Record<string, number> = {
      P0002: 404,
      "42501": 403,
      "28000": 401,
      "22023": 400,
      "22P02": 400,
    };
    const status = statuses[error.code] || 503;
    return NextResponse.json(
      {
        error:
          status === 503
            ? "Event access is temporarily unavailable. Please try again."
            : error.message,
      },
      { status },
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.error('[Event team] RPC returned an invalid payload', { function: name });
    return NextResponse.json(
      { error: "Event access is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
  const { http_status, ...payload } = data;
  return NextResponse.json(payload, {
    status: [400, 404, 409].includes(http_status) ? http_status : 200,
  });
}
