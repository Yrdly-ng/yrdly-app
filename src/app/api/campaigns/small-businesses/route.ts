import { NextResponse } from "next/server";
import { campaignFailure, readCampaign } from "@/lib/campaigns/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const response = NextResponse.json(await readCampaign());
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Origin");
    const origin = request.headers.get("origin");
    if (origin && ["https://yrdly.ng", "https://www.yrdly.ng"].includes(origin))
      response.headers.set("Access-Control-Allow-Origin", origin);
    return response;
  } catch (error) {
    return campaignFailure(error);
  }
}
