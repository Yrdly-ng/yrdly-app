import { publicLinkMetadata } from "@/lib/shared/public-link-metadata";
import { PostPageClient } from "./PostPageClient";
export const revalidate = 0;
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return publicLinkMetadata("posts", (await params).id);
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PostPageClient postId={(await params).id} />;
}
