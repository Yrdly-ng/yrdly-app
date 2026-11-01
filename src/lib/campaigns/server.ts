import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/supabase-server";
import { supabaseAdmin } from "@/lib/supabase/supabase-admin";
import type {
  CampaignAdminResponse,
  CampaignMeResponse,
  CampaignResponse,
} from "./types";

export const CAMPAIGN_RULES_VERSION = "2026-11-v1";
export const uuid = z.string().uuid();
export class CampaignError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export async function campaignActor(
  request: Request,
  admin = false,
): Promise<string> {
  const {
    data: { user },
    error,
  } = await getAuthenticatedUser(request);
  if (!user || error)
    throw new CampaignError(
      "Sign in to continue.",
      error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401,
    );
  if (admin) {
    const { data, error: profileError } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError)
      throw new CampaignError("Could not verify administrator access.", 503);
    if (!data?.is_admin)
      throw new CampaignError("Administrator access required.", 403);
  }
  return user.id;
}

export async function campaignRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc(name, args);
  if (error) {
    if (error.code === "P0001") throw new CampaignError(error.message);
    console.error("[Campaign] Database operation failed", name, error.code);
    throw new CampaignError(
      "Campaign information is temporarily unavailable. Please try again.",
      503,
    );
  }
  if (data == null)
    throw new CampaignError(
      "Campaign information is temporarily unavailable.",
      503,
    );
  return data as T;
}

export async function readCampaign(actor: string | null = null, admin = false) {
  const result = await campaignRpc<
    CampaignResponse | CampaignMeResponse | CampaignAdminResponse
  >("read_sales_campaign", { p_actor: actor, p_admin: admin });
  // Installed mobile versions still read the original singular fields.
  if (actor && "ownEntries" in result) {
    const ownEntry = result.ownEntries[0] || null;
    let participation = null;
    if (ownEntry) {
      const { data, error } = await supabaseAdmin.from("campaign_participations")
        .select("id,business_id,status,approved_at,reason")
        .eq("business_id", ownEntry.businessId).eq("owner_id", actor).maybeSingle();
      if (error || !data) throw new CampaignError("Campaign information is temporarily unavailable.", 503);
      participation = { id: data.id, businessId: data.business_id, status: data.status, approvedAt: data.approved_at, reason: data.reason };
    }
    return { ...result, ownEntry, participation };
  }
  return result;
}

export function campaignFailure(error: unknown) {
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { error: "Please check the submitted campaign details." },
      { status: 400 },
    );
  if (error instanceof CampaignError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  console.error("[Campaign] Request failed");
  return NextResponse.json(
    { error: "Campaign information is temporarily unavailable." },
    { status: 503 },
  );
}

export async function adminCampaignAction(
  request: Request,
  action: string,
  subjectId: string | null,
  reason: string,
  expectedSnapshotId: string | null = null,
) {
  const actor = await campaignActor(request, true);
  return campaignRpc<CampaignAdminResponse>("admin_sales_campaign", {
    p_actor: actor,
    p_action: action,
    p_subject: subjectId,
    p_reason: reason,
    p_expected_snapshot_id: expectedSnapshotId,
  });
}
