export type ReportKind = "general" | "post" | "comment";
export type ReportAction =
  | "resolve"
  | "dismiss"
  | "reopen"
  | "hide"
  | "restore"
  | "suspend"
  | "ban"
  | "unsuspend";
export interface ReportCase {
  id: string;
  kind: ReportKind;
  status: string;
  category: string;
  subject: string;
  description: string;
  createdAt: string;
  reporter: { id: string; name: string } | null;
  reportedAccount: {
    id: string;
    name: string;
    isSuspended: boolean;
    isBanned: boolean;
  } | null;
  content: {
    id: string;
    type: "post" | "comment";
    text: string;
    hidden: boolean;
    postId?: string;
  } | null;
  history: {
    id: string;
    action: string;
    reason: string;
    createdAt: string;
    actorName: string;
  }[];
  sensitive: boolean;
  media: string[];
}
export const reportTables = {
  general: "reports",
  post: "post_reports",
  comment: "comment_reports",
} as const;
export const isReportKind = (v: string): v is ReportKind =>
  Object.prototype.hasOwnProperty.call(reportTables, v);
