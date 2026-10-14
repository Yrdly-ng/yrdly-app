import { NextResponse } from "next/server";
export function GET() {
  const team = process.env.APPLE_TEAM_ID?.trim();
  const details =
    team && /^[A-Z0-9]{10}$/.test(team)
      ? [
          {
            appID: `${team}.com.yrdly`,
            paths: [
              "/posts/*",
              "/marketplace/*",
              "/events/*",
              "/businesses/*",
              "/communities/*",
            ],
          },
        ]
      : [];
  return NextResponse.json(
    { applinks: { apps: [], details } },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
