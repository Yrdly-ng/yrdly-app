import { publicLinkMetadata } from "@/lib/public-link-metadata";
import MarketplaceItemPageClient from "./MarketplaceItemPageClient";

export const revalidate = 0;
export async function generateMetadata({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  return publicLinkMetadata("marketplace", itemId);
}
export default function Page() {
  return <MarketplaceItemPageClient />;
}
