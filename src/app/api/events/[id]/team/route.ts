import { NextResponse } from "next/server";
import {
  eventTeamRpc,
  eventTeamUuid,
  withEventTeamRequest,
} from "@/lib/events/event-team-server";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return withEventTeamRequest(request, async (client) => {
    const { id } = await context.params;
    if (!eventTeamUuid.test(id))
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    return eventTeamRpc(client, "event_team_snapshot", { p_event_id: id });
  });
}

export async function POST(request: Request, context: Context) {
  return withEventTeamRequest(request, async (client) => {
    const { id } = await context.params;
    if (!eventTeamUuid.test(id))
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !["invite", "accept", "decline", "revoke", "update_role"].includes(
        body.action,
      )
    ) {
      return NextResponse.json(
        { error: "Select a valid action" },
        { status: 400 },
      );
    }
    if (body.action === "invite") {
      const validId =
        typeof body.user_id === "string" && eventTeamUuid.test(body.user_id);
      const validEmail =
        typeof body.email === "string" &&
        body.email.trim().length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim());
      if (!validId && !validEmail)
        return NextResponse.json(
          { error: "Enter the email of a YRDLY account" },
          { status: 400 },
        );
      if (body.user_id != null && !validId)
        return NextResponse.json(
          { error: "Invalid team member" },
          { status: 400 },
        );
    } else if (
      typeof body.member_id !== "string" ||
      !eventTeamUuid.test(body.member_id)
    ) {
      return NextResponse.json(
        { error: "Select a team member" },
        { status: 400 },
      );
    }
    if (
      ["invite", "update_role"].includes(body.action) &&
      !["manager", "checkin"].includes(body.role)
    ) {
      return NextResponse.json(
        { error: "Select a valid role" },
        { status: 400 },
      );
    }
    return eventTeamRpc(client, "event_team_mutate", {
      p_event_id: id,
      p_action: body.action,
      p_email:
        body.action === "invite" && typeof body.email === "string"
          ? body.email.trim()
          : null,
      p_user_id: body.action === "invite" ? (body.user_id ?? null) : null,
      p_role: ["invite", "update_role"].includes(body.action)
        ? body.role
        : null,
      p_member_id: body.action === "invite" ? null : body.member_id,
    });
  });
}
