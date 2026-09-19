"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldAlert, CheckCircle2, XCircle, Clock, MapPin, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";

const FONT = "var(--yrdly-font-body)";
const RALEWAY = "var(--yrdly-font-display)";

export default function SafetyAlertsAdminQueuePage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from("safety_alerts").select("*");
      if (activeTab === "pending") {
        query = query.eq("status", "pending").order("created_at", { ascending: false });
      } else {
        query = query.neq("status", "pending").order("created_at", { ascending: false });
      }

      const { data } = await query;
      setAlerts(data || []);
    } catch (err) {
      console.error("Error fetching safety queue:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (profile && !(profile as any).is_admin) {
      toast({ title: "Access denied. Admin privileges required.", variant: "destructive" });
      router.push("/");
      return;
    }
    fetchAlerts();
  }, [profile, fetchAlerts, router, toast]);

  const handleAction = async (alertId: string, status: "approved" | "rejected") => {
    setProcessingId(alertId);
    try {
      const { error } = await supabase
        .from("safety_alerts")
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq("id", alertId);

      if (error) throw error;

      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      toast({ title: `Alert ${status} successfully` });
    } catch (err: any) {
      toast({ title: err.message || "Failed to update status", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <header className="lg:hidden sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-card transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-500" />
          <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
            Safety Moderation Queue
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex bg-card p-1 rounded-xl border border-border/40">
          <button
            onClick={() => setActiveTab("pending")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "pending"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            Pending Review
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "history"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            Reviewed History
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-12 text-center bg-card rounded-2xl border border-border/40 text-muted-foreground space-y-1">
            <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-50" />
            <p className="font-semibold text-sm" style={{ fontFamily: FONT }}>
              No {activeTab} safety alerts
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {alerts.map((item) => (
              <div
                key={item.id}
                className="p-5 rounded-2xl bg-card border border-border/40 space-y-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400">
                    {item.severity || item.alert_type || "Safety Notice"}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1" style={{ fontFamily: FONT }}>
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
                    {item.title}
                  </h3>
                  <p className="text-xs text-muted-foreground flex items-center gap-1" style={{ fontFamily: FONT }}>
                    <MapPin className="w-3.5 h-3.5 text-primary" />
                    {item.area_name || item.area || "Neighborhood"}
                  </p>
                </div>

                <p className="text-sm leading-relaxed text-foreground" style={{ fontFamily: FONT }}>
                  {item.description || item.content}
                </p>

                {activeTab === "pending" ? (
                  <div className="flex items-center gap-3 pt-2 border-t border-border/40">
                    <button
                      onClick={() => handleAction(item.id, "approved")}
                      disabled={processingId === item.id}
                      className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs shadow hover:opacity-90 transition-all flex items-center justify-center gap-1.5"
                      style={{ fontFamily: FONT }}
                    >
                      <CheckCircle2 className="w-4 h-4" /> Approve & Broadcast
                    </button>
                    <button
                      onClick={() => handleAction(item.id, "rejected")}
                      disabled={processingId === item.id}
                      className="flex-1 py-2.5 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10 font-bold text-xs transition-all flex items-center justify-center gap-1.5"
                      style={{ fontFamily: FONT }}
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-border/40 flex justify-end">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${
                        item.status === "approved"
                          ? "bg-green-500/20 text-green-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                      style={{ fontFamily: FONT }}
                    >
                      {item.status}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
