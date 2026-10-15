import { publicLinkMetadata } from "@/lib/shared/public-link-metadata";
import BusinessDetailPageClient from "./BusinessDetailPageClient";

export const revalidate = 0;
export async function generateMetadata({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  return publicLinkMetadata("businesses", businessId);
}
export default function Page() {
  return <BusinessDetailPageClient />;
}
