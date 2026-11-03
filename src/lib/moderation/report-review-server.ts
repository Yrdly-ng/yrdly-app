import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/supabase-server";
import { supabaseAdmin } from "@/lib/supabase/supabase-admin";
import { ReportCase, ReportKind, reportTables } from "./report-case";

export async function requireReportAdmin(request: NextRequest) {
  const {
    data: { user },
    error,
  } = await getAuthenticatedUser(request);
  if (error || !user)
    return {
      response: NextResponse.json(
        { error: "Sign in to continue." },
        {
          status:
            error?.status === 503 ? 503 : error?.status === 403 ? 403 : 401,
        },
      ),
    };
  const { data: profile, error: lookup } = await supabaseAdmin
    .from("users")
    .select("role,is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (lookup)
    return {
      response: NextResponse.json(
        { error: "Staff access could not be verified." },
        { status: 503 },
      ),
    };
  if (!profile || (!profile.is_admin && profile.role !== "admin"))
    return {
      response: NextResponse.json(
        { error: "Admin access required." },
        { status: 403 },
      ),
    };
  return { user };
}
async function rows(table: string, column: string, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .in(column, [...new Set(ids)]);
  if (error) throw error;
  return data || [];
}
export async function enrichReports(
  kind: ReportKind,
  reports: any[],
  detail = false,
): Promise<ReportCase[]> {
  const posts = await rows(
    "posts",
    "id",
    reports.map((r) => r.reported_post_id || r.post_id).filter(Boolean),
  );
  const comments = await rows(
    "comments",
    "id",
    reports.map((r) => r.comment_id).filter(Boolean),
  );
  const newHistory = detail
    ? await rows(
        "report_review_actions",
        "report_id",
        reports.map((r) => r.id),
      )
    : [];
  const legacyContent =
    detail && kind === "general"
      ? await rows(
          "content_moderation_actions",
          "report_id",
          reports.map((r) => r.id),
        )
      : [];
  const legacyAccount =
    detail && kind === "general"
      ? await rows(
          "account_moderation_actions",
          "report_id",
          reports.map((r) => r.id),
        )
      : [];
  const history = [
    ...newHistory.filter((r) => r.report_kind === kind),
    ...legacyContent,
    ...legacyAccount,
  ];
  const users = await rows(
    "users",
    "id",
    [
      ...reports.flatMap((r) => [r.user_id, r.reporter_id, r.reported_user_id]),
      ...posts.map((r) => r.user_id),
      ...comments.map((r) => r.user_id),
      ...history.map((r) => r.actor_user_id),
    ].filter(Boolean),
  );
  const person = (id: string) => users.find((u) => u.id === id);
  return reports.map((r) => {
    const comment = comments.find((c) => c.id === r.comment_id);
    const post = posts.find((p) => p.id === (r.reported_post_id || r.post_id));
    const content = kind === "comment" ? comment : post;
    const reporter = person(r.user_id || r.reporter_id);
    const account = person(r.reported_user_id || content?.user_id);
    return {
      id: r.id,
      kind,
      status: r.status || "open",
      category:
        r.category || (kind === "comment" ? "Comment report" : "Post report"),
      subject:
        r.subject ||
        (kind === "comment" ? "Comment reported" : "Post reported"),
      description: r.description || r.reason || "",
      createdAt: r.created_at,
      reporter: reporter
        ? { id: reporter.id, name: reporter.name || "Unnamed account" }
        : null,
      reportedAccount: account
        ? {
            id: account.id,
            name: account.name || "Unnamed account",
            isSuspended: Boolean(
              account.is_suspended || account.status === "suspended",
            ),
            isBanned: Boolean(account.is_banned || account.status === "banned"),
          }
        : null,
      content: content
        ? {
            id: content.id,
            type: kind === "comment" ? "comment" : "post",
            text:
              content.text ||
              content.content ||
              content.title ||
              "No text supplied.",
            hidden:
              kind === "comment"
                ? Boolean(content.moderation_hidden)
                : content.moderation_status === "rejected",
            postId: kind === "comment" ? comment.post_id : content.id,
          }
        : null,
      history: history
        .filter((h) => h.report_id === r.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((h) => ({
          id: h.id,
          action: h.action,
          reason: h.reason,
          createdAt: h.created_at,
          actorName: person(h.actor_user_id)?.name || "Staff member",
        })),
      sensitive: r.category === "Child safety",
      media:
        r.category === "Child safety"
          ? []
          : [
              r.image_url,
              ...(Array.isArray(content?.image_urls) ? content.image_urls : []),
              content?.image_url,
            ]
              .filter((v): v is string => typeof v === "string" && v.length > 0)
              .slice(0, 10),
    };
  });
}
export async function loadReport(kind: ReportKind, id: string) {
  const { data, error } = await supabaseAdmin
    .from(reportTables[kind])
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? (await enrichReports(kind, [data], true))[0] : null;
}
