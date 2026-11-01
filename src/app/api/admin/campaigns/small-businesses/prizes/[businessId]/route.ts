import { NextResponse } from "next/server";
import { z } from "zod";
import {
  campaignActor,
  campaignFailure,
  campaignRpc,
  uuid,
} from "@/lib/campaigns/server";

const record = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("verification"),
      status: z.enum(["verified", "needs_review", "rejected"]),
      reason: z.string().trim().min(10).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("payment"),
      status: z.literal("recorded"),
      amountKobo: z.number().int().positive().safe().max(50000000),
      reference: z.string().trim().min(1).max(200),
      reason: z.string().trim().min(10).max(1000),
    })
    .strict(),
]);
/** Record an independently verified action. This route never initiates a transfer. */
export async function POST(
  request: Request,
  context: { params: Promise<{ businessId: string }> },
) {
  try {
    const actor = await campaignActor(request, true);
    const businessId = uuid.parse((await context.params).businessId);
    const body = record.parse(await request.json().catch(() => null));
    const result = await campaignRpc("record_campaign_prize", {
      p_actor: actor,
      p_business_id: businessId,
      p_kind: body.kind,
      p_status: body.status,
      p_reason: body.reason,
      p_amount_kobo: body.kind === "payment" ? body.amountKobo : null,
      p_reference: body.kind === "payment" ? body.reference : null,
    });
    return NextResponse.json(
      { record: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return campaignFailure(error);
  }
}
