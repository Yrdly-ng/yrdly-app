"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, AlertTriangle, ShieldCheck, MapPin, Calendar, Share2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-jersey25)";

export default function AlertDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const alertId = params?.alertId as string;

  const [alert, setAlert] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!alertId) return;

    async function fetchAlert() {
      setLoading(true);
      // Try safety_alerts first
      const { data: safetyData } = await supabase
        .from("safety_alerts")
        .select("*")
        .eq("id", alertId)
        .maybeSingle();

      if (safetyData) {
        setAlert({
          ...safetyData,
          area: safetyData.area_name || safetyData.area || "Neighborhood Alert",
          is_resolved: safetyData.status === "resolved" || safetyData.is_resolved,
        });
        setLoading(false);
        return;
      }

      // Fallback to alerts table
      const { data: alertsData } = await supabase
        .from("alerts")
        .select("*")
        .eq("id", alertId)
        .maybeSingle();

      if (alertsData) {
        setAlert({
          ...alertsData,
          area: alertsData.area_name || alertsData.area || "Local Area",
          is_resolved: alertsData.status === "resolved" || alertsData.is_resolved,
        });
      }
      setLoading(false);
    }

    fetchAlert();
  }, [alertId]);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: alert?.title || "Safety Alert",
          text: alert?.description || "Check out this community safety alert on Yrdly.",
          url: window.location.href,
        });
      } catch (err) {
        console.error("Share failed", err);
      }
    } else {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "Link copied to clipboard!" });
    }
  };

  const getSeverityColor = (severity?: string) => {
    switch (severity?.toLowerCase()) {
      case "critical":
      case "high":
        return "#E53935";
      case "medium":
      case "warning":
        return "#F59E0B";
      default:
        return "#3B82F6";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-xs font-bold text-muted-foreground uppercase tracking-wider" style={{ fontFamily: FONT }}>
          Loading alert details...
        </p>
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
        <AlertTriangle className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
          Alert Not Found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs" style={{ fontFamily: FONT }}>
          This safety alert may have been removed or resolved by community moderators.
        </p>
        <button
          onClick={() => router.back()}
          className="mt-6 px-6 py-2.5 rounded-full bg-primary text-primary-foreground font-bold text-sm"
          style={{ fontFamily: FONT }}
        >
          Go Back
        </button>
      </div>
    );
  }

  const severityColor = getSeverityColor(alert.severity);

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      {/* Severity indicator banner */}
      <div className="h-2.5 w-full" style={{ background: severityColor }} />

      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-card transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <span className="text-sm font-bold uppercase tracking-wider" style={{ fontFamily: FONT, color: severityColor }}>
          {alert.severity || "Safety"} Alert
        </span>
        <button
          onClick={handleShare}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-card transition-colors"
        >
          <Share2 className="w-5 h-5 text-foreground" />
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div
          className="p-6 rounded-2xl border space-y-4"
          style={{ background: "var(--c-card)", borderColor: "var(--c-border)" }}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span
              className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-white"
              style={{ background: severityColor }}
            >
              {alert.type || alert.alert_type || "Community"}
            </span>

            {alert.is_resolved ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-400">
                <ShieldCheck className="w-3.5 h-3.5" /> Resolved
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Active Notice
              </span>
            )}
          </div>

          <h1 className="text-2xl font-extrabold text-foreground" style={{ fontFamily: RALEWAY }}>
            {alert.title}
          </h1>

          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pt-1 border-t border-border/40">
            {alert.area && (
              <div className="flex items-center gap-1.5 font-medium">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                {alert.area}
              </div>
            )}
            <div className="flex items-center gap-1.5 font-medium">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              {alert.created_at ? new Date(alert.created_at).toLocaleDateString(undefined, { dateStyle: "medium" }) : "Recently"}
            </div>
          </div>

          <div className="pt-2 text-sm leading-relaxed text-foreground whitespace-pre-wrap" style={{ fontFamily: FONT }}>
            {alert.description || alert.content}
          </div>
        </div>

        {alert.image_url && (
          <div className="relative h-80 rounded-2xl overflow-hidden border border-border/40">
            <Image src={alert.image_url} alt="Alert image" fill className="object-cover" />
          </div>
        )}
      </main>
    </div>
  );
}
