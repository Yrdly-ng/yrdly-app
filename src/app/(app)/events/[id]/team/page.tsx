"use client";
import { useParams } from "next/navigation";
import { EventTeamWorkspace } from "@/components/events/EventTeamWorkspace";
export default function EventTeamPage() {
  const { id } = useParams<{ id: string }>();
  return <EventTeamWorkspace eventId={id} />;
}
