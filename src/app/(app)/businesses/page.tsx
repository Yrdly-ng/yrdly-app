import { redirect } from "next/navigation";

export default function BusinessesPage() {
  redirect("/explore?tab=businesses");
}
