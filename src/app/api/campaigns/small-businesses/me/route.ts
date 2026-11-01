import { NextResponse } from "next/server";
import {
  campaignActor,
  campaignFailure,
  readCampaign,
} from "@/lib/campaigns/server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const response = NextResponse.json(
      await readCampaign(await campaignActor(request)),
    );
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Authorization, Cookie");
    return response;
  } catch (error) {
    return campaignFailure(error);
  }
}
