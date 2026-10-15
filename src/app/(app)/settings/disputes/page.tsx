import AdminDisputesPage from "@/app/(app)/admin/disputes/page";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";

export default function SettingsDisputesPage() {
  return <AdminRouteGuard><AdminDisputesPage /></AdminRouteGuard>;
}
