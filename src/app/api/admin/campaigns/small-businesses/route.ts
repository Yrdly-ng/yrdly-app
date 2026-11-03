import { NextResponse } from "next/server";
import {
  campaignActor,
  campaignFailure,
  readCampaign,
} from "@/lib/campaigns/server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await readCampaign(await campaignActor(request, true), true),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return campaignFailure(error);
  }
}
