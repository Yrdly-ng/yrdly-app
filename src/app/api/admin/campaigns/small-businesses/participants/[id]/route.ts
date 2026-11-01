import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Campaign businesses join automatically. This monitor does not accept participation decisions." },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}
