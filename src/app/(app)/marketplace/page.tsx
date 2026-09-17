import { redirect } from "next/navigation";

export default function MarketplacePage() {
  redirect("/explore?tab=marketplace");
}
