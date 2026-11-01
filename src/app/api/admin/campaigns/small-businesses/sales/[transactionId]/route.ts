import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Campaign sales are recorded from order evidence and cannot be manually changed." },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}
