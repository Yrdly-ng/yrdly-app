import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/supabase-admin";
import { isReportKind } from "@/lib/moderation/report-case";
import {
  loadReport,
  requireReportAdmin,
} from "@/lib/moderation/report-review-server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ kind: string; id: string }> };
const bodySchema = z.object({
  action: z.enum([
    "resolve",
    "dismiss",
    "reopen",
    "hide",
    "restore",
    "suspend",
    "ban",
    "unsuspend",
  ]),
  reason: z.string().trim().min(5).max(500),
  expectedStatus: z.enum(["open", "resolved", "dismissed"]),
});
export async function GET(request: NextRequest, context: Context) {
  const auth = await requireReportAdmin(request);
  if (auth.response) return auth.response;
  const { kind, id } = await context.params;
  if (!isReportKind(kind) || !z.string().uuid().safeParse(id).success)
    return NextResponse.json(
      { error: "Invalid report reference." },
      { status: 400 },
    );
  try {
    const report = await loadReport(kind, id);
    return report
      ? NextResponse.json(report, {
          headers: { "Cache-Control": "private, no-store" },
        })
      : NextResponse.json({ error: "Report not found." }, { status: 404 });
  } catch {
    return NextResponse.json(
      { error: "Report details could not be loaded." },
      { status: 503 },
    );
  }
}
export async function POST(request: NextRequest, context: Context) {
  const auth = await requireReportAdmin(request);
  if (auth.response) return auth.response;
  const { kind, id } = await context.params;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (
    !isReportKind(kind) ||
    !z.string().uuid().safeParse(id).success ||
    !body.success
  )
    return NextResponse.json(
      { error: "A valid report, action and explanation are required." },
      { status: 400 },
    );
  const { error } = await supabaseAdmin.rpc("admin_review_report", {
    p_actor: auth.user!.id,
    p_kind: kind,
    p_id: id,
    p_action: body.data.action,
    p_reason: body.data.reason,
    p_expected_status: body.data.expectedStatus,
  });
  if (error)
    return NextResponse.json(
      {
        error:
          error.code === "40001"
            ? "This report changed. Refresh before acting."
            : error.code === "P0002"
              ? "Report or linked content is unavailable."
              : "Action could not be completed. Refresh and try again.",
      },
      {
        status:
          error.code === "P0002"
            ? 404
            : error.code === "42501"
              ? 403
              : error.code === "40001"
                ? 409
                : 400,
      },
    );
  return NextResponse.json({ success: true });
}
