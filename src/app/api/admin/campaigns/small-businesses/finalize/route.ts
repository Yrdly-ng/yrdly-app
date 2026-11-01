import { NextResponse } from "next/server";
import { z } from "zod";
import { adminCampaignAction, campaignFailure } from "@/lib/campaigns/server";

const decision = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    expectedSnapshotId: z.string().regex(/^[a-f0-9]{32}$/),
  })
  .strict();
export async function POST(request: Request) {
  try {
    const body = decision.parse(await request.json().catch(() => null));
    return NextResponse.json(
      await adminCampaignAction(
        request,
        "finalize",
        null,
        body.reason,
        body.expectedSnapshotId,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return campaignFailure(error);
  }
}
