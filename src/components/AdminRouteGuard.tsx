"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace("/login");
          return;
        }
        const { data: profile, error } = await supabase
          .from("users")
          .select("is_admin, role")
          .eq("id", user.id)
          .maybeSingle();
        const isAdmin = !error && (
          profile?.is_admin === true ||
          profile?.role === "admin" ||
          user.app_metadata?.role === "admin"
        );
        if (!isAdmin) {
          router.replace("/home");
          return;
        }
        if (active) setAuthorized(true);
      } catch {
        router.replace("/home");
      } finally {
        if (active) setChecking(false);
      }
    };
    void check();
    return () => { active = false; };
  }, [router]);

  if (checking || !authorized) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: "var(--c-bg)" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--primary))", borderTopColor: "transparent" }} />
          <p className="text-sm text-muted-foreground">Verifying access...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
