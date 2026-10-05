"use client";

import { AdminRouteGuard } from "@/components/AdminRouteGuard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminRouteGuard>{children}</AdminRouteGuard>;
}
