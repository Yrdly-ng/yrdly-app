import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/supabase-admin";
import { isReportKind, reportTables } from "@/lib/moderation/report-case";
import {
  enrichReports,
  requireReportAdmin,
} from "@/lib/moderation/report-review-server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const auth = await requireReportAdmin(request);
  if (auth.response) return auth.response;
  const q = request.nextUrl.searchParams,
    kind = q.get("kind") || "general",
    status = q.get("status") || "open",
    page = Number(q.get("page") || 1);
  if (
    !isReportKind(kind) ||
    !["all", "open", "resolved", "dismissed"].includes(status) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000
  )
    return NextResponse.json(
      { error: "Invalid report filter." },
      { status: 400 },
    );
  try {
    let query = supabaseAdmin
      .from(reportTables[kind])
      .select("*", { count: "exact" })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range((page - 1) * 20, page * 20 - 1);
    if (status !== "all") query = query.eq("status", status);
    if (q.get("category") && kind === "general")
      query = query.eq("category", q.get("category"));
    const { data, count, error } = await query;
    if (error) throw error;
    return NextResponse.json(
      { data: await enrichReports(kind, data || []), count: count || 0 },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Reports could not be loaded. Please retry." },
      { status: 503 },
    );
  }
}
