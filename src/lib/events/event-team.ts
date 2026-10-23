import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";

export type EventTeamRole = "manager" | "checkin";
export type EventTeamStatus =
  "pending" | "active" | "revoked" | "declined" | "expired";
export interface EventAssignment {
  id: string;
  event_id: string;
  expires_at?: string | null;
  role: EventTeamRole;
  status: EventTeamStatus;
  event: { id: string; title: string; start_time: string; status: string };
}
export interface EventTeamMember {
  id: string;
  user_id: string;
  role: EventTeamRole;
  status: EventTeamStatus;
  expires_at?: string | null;
  name?: string;
  user?: { name: string; email?: string };
}
export interface EventTeamData {
  event: { id: string; title: string; status: string };
  role: "organizer" | EventTeamRole;
  members: EventTeamMember[];
  summary: { total: number; checked_in: number; remaining: number };
  guests?: {
    id: string;
    attendee_name?: string;
    user_name?: string;
    status: string;
    tier_name?: string;
    tier?: { name: string };
  }[];
  history: {
    id: string;
    ticket_code?: string;
    attendee_name?: string;
    scanned_at: string;
    scanned_by: string;
    scanner_name?: string;
  }[];
}
export interface EventTeamAction {
  action: "invite" | "accept" | "decline" | "revoke" | "update_role";
  email?: string;
  role?: EventTeamRole;
  member_id?: string;
}
export const eventTeamRoleLabel = (role: string) =>
  role === "organizer"
    ? "Organiser"
    : role === "manager"
      ? "Event manager"
      : "Check-in staff";
export const eventTeamEndpoint = (eventId?: string) =>
  eventId
    ? `/api/events/${encodeURIComponent(eventId)}/team`
    : "/api/events/team";

/** Authenticated requests retain status so revoked access clears attendance data. */
export function eventTeamRequest<T>(
  path: string,
  body?: EventTeamAction,
): Promise<T> {
  return authenticatedFetch<T>(path, body, body ? "POST" : "GET");
}
