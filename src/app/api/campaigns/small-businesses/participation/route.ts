import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CAMPAIGN_RULES_VERSION,
  campaignActor,
  campaignFailure,
  campaignRpc,
  readCampaign,
  uuid,
} from "@/lib/campaigns/server";
import type { CampaignMeResponse } from "@/lib/campaigns/types";

const enrollment = z
  .object({
    businessId: uuid,
    acceptRules: z.literal(true),
    rulesVersion: z.literal(CAMPAIGN_RULES_VERSION).optional(),
  })
  .strict();
export async function POST(request: Request) {
  try {
    const actor = await campaignActor(request);
    const body = enrollment.parse(await request.json().catch(() => null));
    await campaignRpc("enroll_sales_campaign", {
      p_actor: actor,
      p_business_id: body.businessId,
      p_rules_version: CAMPAIGN_RULES_VERSION,
    });
    const result = (await readCampaign(actor)) as CampaignMeResponse;
    return NextResponse.json(
      { participation: result.participation },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return campaignFailure(error);
  }
}
