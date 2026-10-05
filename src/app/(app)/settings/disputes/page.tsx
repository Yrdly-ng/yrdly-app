import AdminDisputesPage from "@/app/(app)/admin/disputes/page";
import { AdminRouteGuard } from "@/components/AdminRouteGuard";

export default function SettingsDisputesPage() {
  return <AdminRouteGuard><AdminDisputesPage /></AdminRouteGuard>;
}
