import {
  eventTeamRpc,
  withEventTeamRequest,
} from "@/lib/events/event-team-server";

export async function GET(request: Request) {
  return withEventTeamRequest(request, (client) =>
    eventTeamRpc(client, "event_team_assignments"),
  );
}
