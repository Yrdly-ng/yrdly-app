import { supabase } from "@/lib/supabase";
import { AuthService } from "@/lib/auth-service";

export type AlertSeverity = "information" | "caution" | "urgent";

export interface Alert {
  id: string;
  source_table: "safety_alerts" | "alerts";
  type: string;
  title: string;
  description: string;
  status: "active" | "resolved" | "expired";
  severity: AlertSeverity;
  area?: string;
  action?: string;
  source: string;
  is_resolved: boolean;
  created_at: string;
  created_by?: string;
}

export interface CreateAlertData {
  title: string;
  description: string;
  severity: AlertSeverity;
  type: "safety" | "amber" | "info";
  area_name: string;
  state?: string;
  lga?: string;
  ward?: string;
  action?: string;
}

function normalizeSeverity(raw: string | null | undefined): AlertSeverity {
  switch (raw) {
    case "urgent":
    case "critical":
    case "high":
      return "urgent";
    case "caution":
    case "medium":
      return "caution";
    default:
      return "information";
  }
}

export class AlertService {
  /**
   * Fetches all visible alerts for the feed: approved community safety
   * alerts plus admin-broadcast alerts (active + recently resolved).
   */
  static async getActiveAlerts(): Promise<Alert[]> {
    try {
      const [{ data: safetyRows, error: safetyError }, { data: adminRows, error: adminError }] =
        await Promise.all([
          supabase
            .from("safety_alerts")
            .select("*")
            .eq("status", "approved")
            .order("created_at", { ascending: false }),
          supabase
            .from("alerts")
            .select("*")
            .gte(
              "created_at",
              new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
            )
            .order("created_at", { ascending: false })
            .limit(50),
        ]);

      if (safetyError) console.error("Error fetching safety alerts:", safetyError);
      if (adminError) console.error("Error fetching admin alerts:", adminError);

      const now = new Date();

      const safetyAlerts: Alert[] = (safetyRows || []).map((a: any) => ({
        id: a.id,
        source_table: "safety_alerts",
        type: a.type,
        title: a.title,
        description: a.description,
        status: "active",
        severity: normalizeSeverity(a.severity),
        area: a.area_name,
        action: a.action,
        source: "user",
        is_resolved: false,
        created_at: a.created_at,
        created_by: a.user_id,
      }));

      const adminAlerts: Alert[] = (adminRows || [])
        .filter((a: any) => {
          if (a.is_resolved) return true;
          if (a.expires_at && new Date(a.expires_at) < now) return false;
          return true;
        })
        .map((a: any) => ({
          id: a.id,
          source_table: "alerts",
          type: a.type,
          title: a.title,
          description: a.description,
          status: a.is_resolved ? ("resolved" as const) : ("active" as const),
          severity: normalizeSeverity(a.severity),
          area: a.last_seen_address,
          source: a.source || "admin",
          is_resolved: !!a.is_resolved,
          created_at: a.created_at,
          created_by: a.created_by,
        }));

      return [...safetyAlerts, ...adminAlerts].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    } catch (error) {
      console.error("getActiveAlerts error:", error);
      return [];
    }
  }

  /**
   * Fetches the most recent urgent alert for the sticky top banner.
   */
  static async getActiveAlert(): Promise<Alert | null> {
    try {
      const { data, error } = await supabase
        .from("safety_alerts")
        .select("*")
        .eq("status", "approved")
        .eq("severity", "urgent")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching active alert:", error);
        return null;
      }

      if (!data) return null;

      return {
        id: data.id,
        source_table: "safety_alerts",
        type: data.type,
        title: data.title,
        description: data.description,
        status: "active",
        severity: "urgent",
        area: data.area_name,
        action: data.action,
        source: "user",
        is_resolved: false,
        created_at: data.created_at,
        created_by: data.user_id,
      };
    } catch (error) {
      console.error("getActiveAlert error:", error);
      return null;
    }
  }

  /**
   * Submit a new community safety alert. Any authenticated user can submit;
   * it stays pending until an admin approves it.
   */
  static async createAlert(alertData: CreateAlertData) {
    try {
      const currentUser = await AuthService.getCurrentUser();
      if (!currentUser) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("safety_alerts")
        .insert({
          user_id: currentUser.id,
          title: alertData.title,
          description: alertData.description,
          severity: alertData.severity,
          type: alertData.type,
          area_name: alertData.area_name,
          ...(alertData.state ? { state: alertData.state } : {}),
          ...(alertData.lga ? { lga: alertData.lga } : {}),
          ...(alertData.ward ? { ward: alertData.ward } : {}),
          ...(alertData.action ? { action: alertData.action } : {}),
          status: "pending",
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error("createAlert error:", error);
      return { data: null, error };
    }
  }

  /**
   * Resolve an admin-broadcast alert (admin only).
   */
  static async resolveAlert(alertId: string) {
    try {
      const currentUser = await AuthService.getCurrentUser();
      if (!currentUser) throw new Error("Not authenticated");

      const isAdmin = await AlertService.isUserAdmin(currentUser.id);
      if (!isAdmin) throw new Error("Not authorized to resolve alerts");

      const { error } = await supabase
        .from("alerts")
        .update({
          is_resolved: true,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", alertId);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error("resolveAlert error:", error);
      return { error };
    }
  }

  static async isUserAdmin(userId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("is_admin")
        .eq("id", userId)
        .maybeSingle();

      if (error) return false;
      return !!(data as { is_admin?: boolean } | null)?.is_admin;
    } catch {
      return false;
    }
  }
}
