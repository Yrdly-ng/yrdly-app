import ModerationQueuePage from "@/app/(app)/admin/moderation/page";
import { AdminRouteGuard } from "@/components/AdminRouteGuard";

export default function SettingsModerationPage() {
  return <AdminRouteGuard><ModerationQueuePage /></AdminRouteGuard>;
}
