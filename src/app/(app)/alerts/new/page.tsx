"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Warning } from "@phosphor-icons/react";
import { AlertService, type AlertSeverity } from "@/lib/alert-service";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const FONT = "var(--font-work-sans)";

const SEVERITIES: { key: AlertSeverity; label: string; color: string }[] = [
  { key: "information", label: "Info", color: "#3b82f6" },
  { key: "caution", label: "Caution", color: "#f59e0b" },
  { key: "urgent", label: "Urgent", color: "#ef4444" },
];

const TYPES: { key: "safety" | "amber" | "info"; label: string }[] = [
  { key: "safety", label: "Safety Alert" },
  { key: "amber", label: "Amber Alert" },
  { key: "info", label: "Community Info" },
];

export default function CreateAlertPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<AlertSeverity>("caution");
  const [type, setType] = useState<"safety" | "amber" | "info">("safety");
  const [area, setArea] = useState("");
  const [action, setAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [published, setPublished] = useState(false);

  const canSubmit = title.trim() && description.trim() && area.trim();

  const handleSubmit = async () => {
    if (!user || !canSubmit || submitting) return;

    setSubmitting(true);
    const { error } = await AlertService.createAlert({
      title: title.trim(),
      description: description.trim(),
      severity,
      type,
      area_name: area.trim(),
      action: action.trim() || undefined,
    });
    setSubmitting(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to submit alert. Please try again.",
      });
      return;
    }

    setPublished(true);
  };

  if (published) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-center px-6">
        <div
          className="flex items-center justify-center w-[72px] h-[72px] rounded-3xl mb-5"
          style={{
            background: "rgba(56,142,60,0.12)",
            border: "1px solid rgba(56,142,60,0.25)",
          }}
        >
          <Check size={34} weight="bold" style={{ color: "hsl(var(--primary))" }} />
        </div>
        <h2 className="text-[1.375rem] font-bold text-foreground mb-2" style={{ fontFamily: FONT }}>
          Alert Submitted
        </h2>
        <p
          className="text-sm text-[var(--c-text-muted)] max-w-xs mb-6"
          style={{ fontFamily: FONT }}
        >
          The alert has been submitted to admins for review. It will be live once approved.
        </p>
        <button
          onClick={() => router.replace("/alerts")}
          className="h-12 px-8 rounded-full text-sm font-bold text-foreground transition-all active:scale-95"
          style={{ background: "hsl(var(--primary))", fontFamily: FONT }}
        >
          Back to Alerts
        </button>
        <button
          onClick={() => router.replace("/home")}
          className="mt-3 text-sm hover:underline"
          style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
        >
          Back to Feed
        </button>
      </div>
    );
  }

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="flex items-center gap-3 pt-1 pb-5">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--c-card2)] border border-[var(--c-border)] text-foreground flex-shrink-0"
        >
          <ArrowLeft size={18} weight="bold" />
        </button>
        <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: FONT }}>
          Create Safety Alert
        </h1>
      </div>

      <div className="space-y-6">
        {/* Severity */}
        <div>
          <p
            className="text-[0.75rem] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
          >
            Severity
          </p>
          <div className="flex gap-2">
            {SEVERITIES.map(({ key, label, color }) => {
              const active = severity === key;
              return (
                <button
                  key={key}
                  onClick={() => setSeverity(key)}
                  className="flex-1 py-2.5 rounded-xl text-[0.8125rem] font-bold border-[1.5px] transition-all active:scale-95"
                  style={{
                    background: active ? `${color}15` : "transparent",
                    borderColor: active ? color : "var(--c-border)",
                    color: active ? color : "var(--c-text-muted)",
                    fontFamily: FONT,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Type */}
        <div>
          <p
            className="text-[0.75rem] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
          >
            Alert Type
          </p>
          <div className="flex gap-2">
            {TYPES.map(({ key, label }) => {
              const active = type === key;
              return (
                <button
                  key={key}
                  onClick={() => setType(key)}
                  className="flex-1 py-2.5 rounded-xl text-[0.75rem] border-[1.5px] transition-all active:scale-95"
                  style={{
                    background: active ? "var(--c-card2)" : "transparent",
                    borderColor: active ? "hsl(var(--primary))" : "var(--c-border)",
                    color: active ? "var(--foreground)" : "var(--c-text-muted)",
                    fontFamily: FONT,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Title */}
        <div>
          <p
            className="text-[0.75rem] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
          >
            Alert Title
          </p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Road closure at Admiralty Way"
            maxLength={120}
            className="w-full h-12 px-4 rounded-2xl text-[0.9375rem] border border-[var(--c-border)] bg-[var(--c-card)] text-foreground placeholder:text-[var(--c-text-muted)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            style={{ fontFamily: FONT }}
          />
        </div>

        {/* Area */}
        <div>
          <p
            className="text-[0.75rem] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
          >
            Affected Area
          </p>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="e.g. Lekki Phase 1, Lagos"
            className="w-full h-12 px-4 rounded-2xl text-[0.9375rem] border border-[var(--c-border)] bg-[var(--c-card)] text-foreground placeholder:text-[var(--c-text-muted)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            style={{ fontFamily: FONT }}
          />
        </div>

        {/* Action */}
        <div>
          <p
            className="text-[0.75rem] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
          >
            Recommended Action <span className="normal-case opacity-70">(optional)</span>
          </p>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. Avoid Admiralty Way, use Chevron Drive"
            className="w-full h-12 px-4 rounded-2xl text-[0.9375rem] border border-[var(--c-border)] bg-[var(--c-card)] text-foreground placeholder:text-[var(--c-text-muted)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            style={{ fontFamily: FONT }}
          />
        </div>

        {/* Description */}
        <div>
          <p
            className="text-[0.75rem] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
          >
            Description
          </p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Factual description of what is happening…"
            rows={5}
            className="w-full px-4 py-3 rounded-2xl text-[0.9375rem] border border-[var(--c-border)] bg-[var(--c-card)] text-foreground placeholder:text-[var(--c-text-muted)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 resize-none"
            style={{ fontFamily: FONT }}
          />
        </div>

        {/* Review notice */}
        <div
          className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl text-[0.8125rem]"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
        >
          <Warning size={16} weight="fill" style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
          <p style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
            Alerts are reviewed by admins before they go live. False reports may lead to account
            restrictions.
          </p>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className={cn(
            "w-full h-14 rounded-2xl text-base font-bold transition-all active:scale-[0.98] disabled:opacity-50",
          )}
          style={{ background: "#ef4444", color: "#fff", fontFamily: FONT }}
        >
          {submitting ? "Submitting…" : "Submit Alert"}
        </button>
      </div>
    </div>
  );
}
