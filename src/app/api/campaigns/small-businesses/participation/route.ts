import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Eligible Businessplace businesses are included automatically." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
