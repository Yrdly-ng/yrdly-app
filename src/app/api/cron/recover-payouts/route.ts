import { NextRequest, NextResponse } from "next/server";
import { AutomaticPayoutRecovery } from "@/lib/payments/automatic-payout-recovery";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.PAYOUT_RECOVERY_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await AutomaticPayoutRecovery.runOne());
  } catch (error) {
    console.error("[PayoutRecovery] Scheduled recovery failed", error);
    return NextResponse.json(
      { error: "Recovery check failed" },
      { status: 500 },
    );
  }
}
