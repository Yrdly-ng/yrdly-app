"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/supabase";
import { prepareNotificationNavigation } from "@/lib/notifications/notification-navigation";

/** Resolve push taps after authentication, before rendering a potentially missing detail. */
export function NotificationRouteGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const id = search.get("notificationId");
  const recipientId = search.get("recipientId");
  const legacyTarget = search.get("notificationTarget");
  const key = `${user?.id}:${id}:${legacyTarget}:${pathname}`;
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if ((!id && !legacyTarget) || !user) return;
    let active = true;
    const run = async () => {
      if (recipientId && recipientId !== user.id) {
        if (active) {
          toast({ title: "This notification belongs to another account." });
          router.replace("/notifications");
        }
        return;
      }
      let source: Record<string, any> = { url: legacyTarget };
      if (id) {
        const { data, error } = await supabase
          .from("notifications")
          .select("id,type,related_id,related_type,sender_id,data")
          .eq("id", id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!active) return;
        if (error) {
          setFailed(key);
          return;
        }
        if (!data) {
          toast({ title: "This notification is no longer available." });
          router.replace("/notifications");
          return;
        }
        source = data;
      }
      const result = await prepareNotificationNavigation(source);
      if (!active) return;
      if (result.failed) {
        setFailed(key);
        return;
      }
      if (result.unavailable)
        toast({ title: "This item was removed or is no longer accessible." });
      if (id)
        await supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("id", id)
          .eq("user_id", user.id);
      if (!active) return;
      router.replace(result.destination);
    };
    void run().catch(() => {
      if (active) setFailed(key);
    });
    return () => {
      active = false;
    };
  }, [
    id,
    legacyTarget,
    recipientId,
    user?.id,
    pathname,
    attempt,
    router,
    toast,
    key,
  ]);

  if (id || legacyTarget) {
    if (failed === key)
      return (
        <div role="alert" className="p-6 text-center">
          <p>We could not open this notification. Please try again.</p>
          <button
            onClick={() => {
              setFailed("");
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      );
    return (
      <div role="status" className="p-6 text-center">
        Opening notification…
      </div>
    );
  }
  return <>{children}</>;
}
