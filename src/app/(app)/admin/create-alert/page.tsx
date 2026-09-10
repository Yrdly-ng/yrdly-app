"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, X, AlertTriangle, Check, ShieldAlert, Loader2 } from "lucide-react";
import { LocationInput } from "@/components/LocationInput";
import { cn } from "@/lib/utils";

const SEVERITY_COLORS = {
  information: {
    bg: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.2)",
    text: "#3b82f6",
    icon: "#3b82f6",
  },
  caution: {
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.2)",
    text: "#f59e0b",
    icon: "#f59e0b",
  },
  urgent: {
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.2)",
    text: "#ef4444",
    icon: "#ef4444",
  },
};

const TYPE_LABELS = {
  safety: "SAFETY ALERT",
  amber: "AMBER ALERT",
  info: "COMMUNITY INFO",
};

export default function AdminCreateAlertPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<"form" | "preview">("form");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [severity, setSeverity] = useState<"information" | "caution" | "urgent">("caution");
  const [type, setType] = useState<"safety" | "amber" | "info">("safety");
  const [area, setArea] = useState("");
  const [action, setAction] = useState("");

  const [published, setPublished] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canPreview = title.trim() && desc.trim() && area.trim();

  const handlePublish = async () => {
    if (!user) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("safety_alerts").insert({
        user_id: user.id,
        title,
        description: desc,
        severity,
        type,
        area_name: area,
        ...(action ? { action } : {}),
        status: "approved",
      });

      if (error) throw error;
      setPublished(true);
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Error",
        description: err.message || "Failed to publish alert.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (published) {
    return (
      <div className="min-h-screen bg-[var(--yrdly-dark)] flex flex-col items-center justify-center p-6 text-center text-foreground font-yrdly-body space-y-4">
        <div className="w-18 h-18 rounded-3xl bg-[#82DB7E]/10 border border-[#82DB7E]/25 flex items-center justify-center p-4">
          <Check className="w-10 h-10 text-[#82DB7E]" />
        </div>
        <h1 className="text-2xl font-bold font-yrdly-display">Alert Submitted</h1>
        <p className="text-sm text-[var(--yrdly-label)] max-w-sm">
          The alert has been submitted to admins for review. It will be live once approved.
        </p>
        <button
          onClick={() => router.push("/explore")}
          className="px-8 py-3.5 rounded-2xl bg-[#82DB7E] text-black font-extrabold text-sm hover:opacity-90 transition-opacity"
        >
          Back to Explore
        </button>
        <button
          onClick={() => router.push("/")}
          className="text-sm text-[var(--yrdly-label)] hover:text-foreground transition-colors"
        >
          Back to Feed
        </button>
      </div>
    );
  }

  const c = SEVERITY_COLORS[severity];

  if (step === "preview") {
    return (
      <div className="min-h-screen bg-[var(--yrdly-dark)] text-foreground font-yrdly-body flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--yrdly-glass-border)]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStep("form")}
              className="w-9 h-9 rounded-xl bg-card border border-[var(--yrdly-glass-border)] flex items-center justify-center hover:opacity-70 transition-opacity"
            >
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </button>
            <h1 className="text-lg font-bold font-yrdly-display">Preview Alert</h1>
          </div>
          <button
            onClick={handlePublish}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-xl bg-red-600 text-white font-bold text-xs hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Publish Alert"}
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-w-2xl mx-auto w-full space-y-6 flex-1">
          <div>
            <h2 className="text-xs font-bold text-[var(--yrdly-label)] uppercase tracking-wider mb-2">
              Home Feed Banner
            </h2>
            <div
              className="flex items-start gap-3 p-4 rounded-2xl border"
              style={{ backgroundColor: c.bg, borderColor: c.border }}
            >
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: c.icon }} />
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold" style={{ color: c.text }}>
                    {TYPE_LABELS[type]}
                  </span>
                  <span className="text-xs text-[var(--yrdly-label)]">
                    · {area || "Your Area"} · Now
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{desc || "Alert description will appear here."}</p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xs font-bold text-[var(--yrdly-label)] uppercase tracking-wider mb-2">
              Alert Detail Preview
            </h2>
            <div
              className="p-5 rounded-3xl border space-y-2"
              style={{ backgroundColor: c.bg, borderColor: c.border }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded text-[11px] font-bold"
                  style={{ backgroundColor: `${c.icon}22`, color: c.text }}
                >
                  {TYPE_LABELS[type]}
                </span>
                <span className="text-xs text-[var(--yrdly-label)]">Now</span>
              </div>
              <h3 className="text-xl font-bold font-yrdly-display">{title || "Alert title"}</h3>
              <p className="text-xs text-[var(--yrdly-label)]">📍 {area || "Affected area"}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--yrdly-dark)] text-foreground font-yrdly-body flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--yrdly-glass-border)]">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-xl bg-card border border-[var(--yrdly-glass-border)] flex items-center justify-center hover:opacity-70 transition-opacity"
        >
          <X className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-lg font-bold font-yrdly-display">Create Safety Alert</h1>
        <div className="w-9" />
      </div>

      {/* Form Content */}
      <div className="p-6 max-w-2xl mx-auto w-full space-y-6 flex-1">
        {/* Severity */}
        <div>
          <label className="text-xs font-bold text-[var(--yrdly-label)] uppercase tracking-wider mb-2 block">
            Severity
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["information", "Info", "#64B5F6"],
                ["caution", "Caution", "#FFB74D"],
                ["urgent", "Urgent", "#EF4444"],
              ] as const
            ).map(([key, label, color]) => {
              const isSelected = severity === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSeverity(key)}
                  className={cn(
                    "py-2.5 rounded-xl border text-xs font-bold transition-all",
                    isSelected
                      ? "border-current"
                      : "bg-card border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)]"
                  )}
                  style={{
                    backgroundColor: isSelected ? `${color}15` : undefined,
                    borderColor: isSelected ? color : undefined,
                    color: isSelected ? color : undefined,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Alert Type */}
        <div>
          <label className="text-xs font-bold text-[var(--yrdly-label)] uppercase tracking-wider mb-2 block">
            Alert Type
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["safety", "Safety Alert"],
                ["amber", "Amber Alert"],
                ["info", "Community Info"],
              ] as const
            ).map(([key, label]) => {
              const isSelected = type === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setType(key)}
                  className={cn(
                    "py-2.5 rounded-xl border text-xs font-bold transition-all",
                    isSelected
                      ? "bg-card border-[#82DB7E] text-foreground"
                      : "bg-transparent border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)]"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="text-xs font-bold text-[var(--yrdly-label)] uppercase tracking-wider mb-2 block">
            Alert Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Road closure at Admiralty Way"
            className="w-full bg-card rounded-2xl border border-[var(--yrdly-glass-border)] px-4 py-3.5 text-sm text-foreground placeholder:text-[var(--yrdly-label)] outline-none"
          />
        </div>

        {/* Affected Area */}
        <div>
          <label className="text-xs font-bold text-[var(--yrdly-label)] uppercase tracking-wider mb-2 block">
            Affected Area
          </label>
          <input
            type="text"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="e.g. Lekki Phase 1, Lagos"
            className="w-full bg-card rounded-2xl border border-[var(--yrdly-glass-border)] px-4 py-3.5 text-sm text-foreground placeholder:text-[var(--yrdly-label)] outline-none"
          />
        </div>

        {/* Recommended Action */}
        <div>
          <label className="text-xs font-bold text-[var(--yrdly-label)] uppercase tracking-wider mb-2 block">
            Recommended Action
          </label>
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. Avoid Admiralty Way, use Chevron Drive"
            className="w-full bg-card rounded-2xl border border-[var(--yrdly-glass-border)] px-4 py-3.5 text-sm text-foreground placeholder:text-[var(--yrdly-label)] outline-none"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-bold text-[var(--yrdly-label)] uppercase tracking-wider mb-2 block">
            Description
          </label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Factual description of what is happening…"
            rows={4}
            className="w-full bg-card rounded-2xl border border-[var(--yrdly-glass-border)] px-4 py-3.5 text-sm text-foreground placeholder:text-[var(--yrdly-label)] outline-none resize-none"
          />
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="p-6 border-t border-[var(--yrdly-glass-border)] max-w-2xl mx-auto w-full">
        <button
          disabled={!canPreview}
          onClick={() => setStep("preview")}
          className="w-full py-4 rounded-2xl bg-[#82DB7E] text-black font-extrabold text-base transition-opacity disabled:opacity-30 hover:opacity-90"
        >
          Preview Alert
        </button>
      </div>
    </div>
  );
}
