"use client";

import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminRouteGuard>{children}</AdminRouteGuard>;
}
