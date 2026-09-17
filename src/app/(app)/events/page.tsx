import { redirect } from "next/navigation";

export default function EventsPage() {
  redirect("/explore?tab=events");
}
