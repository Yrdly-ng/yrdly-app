import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adminCampaignAction,
  campaignFailure,
  uuid,
} from "@/lib/campaigns/server";

const decision = z
  .object({
    action: z.enum(["hold", "clear"]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ transactionId: string }> },
) {
  try {
    const id = uuid.parse((await context.params).transactionId);
    const body = decision.parse(await request.json().catch(() => null));
    return NextResponse.json(
      await adminCampaignAction(request, body.action, id, body.reason),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return campaignFailure(error);
  }
}
