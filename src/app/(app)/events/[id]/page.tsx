import { publicLinkMetadata } from "@/lib/public-link-metadata";
import EventPageClient from "./EventPageClient";

export const revalidate = 0;
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return publicLinkMetadata("events", id);
}
export default function Page() {
  return <EventPageClient />;
}
