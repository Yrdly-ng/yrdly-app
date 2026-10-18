import { after, NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/supabase-server";
import { supabaseAdmin } from "@/lib/supabase/supabase-admin";
import { invokeServerFunction } from "@/lib/notifications/server-functions";

export const maxDuration = 60;
/** Wake the durable worker; the caller cannot choose jobs or forge moderation results. */
export async function POST(request: NextRequest) {
  const {
    data: { user },
    error,
  } = await getAuthenticatedUser(request);
  if (error || !user)
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: error?.status === 503 ? 503 : error?.status === 403 ? 403 : 401,
      },
    );
  const body = await request.json().catch(() => null);
  if (
    typeof body?.communityId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.communityId)
  )
    return NextResponse.json({ error: "Invalid community" }, { status: 400 });
  const allowed = await supabaseAdmin.rpc("consume_rate_limit", {
    p_user_id: user.id,
    p_endpoint: "/api/communities/process",
    p_max_requests: 10,
    p_window_seconds: 60,
  });
  if (allowed.error || !allowed.data)
    return NextResponse.json({ queued: true }, { status: 202 });
  // Jobs are already authorized, persisted, and immutable to clients. A periodic
  // worker handles recovery even if this best-effort immediate wake-up fails.
  after(async () => {
    await invokeServerFunction(supabaseAdmin, "process-community-jobs", {});
  });
  return NextResponse.json({ queued: true }, { status: 202 });
}
