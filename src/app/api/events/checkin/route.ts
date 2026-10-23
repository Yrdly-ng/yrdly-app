import { NextResponse } from "next/server";
import {
  eventTeamRpc,
  eventTeamUuid,
  withEventTeamRequest,
} from "@/lib/events/event-team-server";

/** Online check-in is authorized and committed atomically with the ticket audit. */
export async function POST(request: Request) {
  return withEventTeamRequest(request, async (client) => {
    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.ticket_code !== "string" ||
      !body.ticket_code.trim() ||
      body.ticket_code.length > 200 ||
      typeof body.event_id !== "string" ||
      !eventTeamUuid.test(body.event_id)
    ) {
      return NextResponse.json(
        { error: "ticket_code and event_id are required" },
        { status: 400 },
      );
    }
    return eventTeamRpc(client, "event_team_checkin", {
      p_event_id: body.event_id,
      p_ticket_code: body.ticket_code.trim(),
    });
  });
}
