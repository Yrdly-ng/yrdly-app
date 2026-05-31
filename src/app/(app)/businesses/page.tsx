"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Clock, Briefcase, Bell } from "lucide-react";

const GREEN = "#388E3C";
const GREEN_LIGHT = "#82DB7E";
const CARD = "var(--c-card)";
const FONT = "\"Pacifico\", cursive";
const PACIFICO = "Pacifico, cursive";

export default function BusinessesPage() {
  const router = useRouter();

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-6 py-16 text-center relative overflow-hidden"
      style={{ background: "var(--c-bg)" }}
    >
      {/* Ambient glow */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(56,142,60,0.12) 0%, transparent 70%)",
        }}
      />

      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="absolute top-6 left-4 flex items-center gap-2 text-sm transition-opacity hover:opacity-70"
        style={{ color: GREEN_LIGHT, fontFamily: FONT }}
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {/* Icon */}
      <div
        className="w-24 h-24 rounded-full flex items-center justify-center mb-8 relative"
        style={{ background: "rgba(56,142,60,0.12)", border: "1px solid rgba(130,219,126,0.2)" }}
      >
        <Briefcase className="w-10 h-10" style={{ color: GREEN_LIGHT }} />
        <div
          className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ background: GREEN }}
        >
          <Clock className="w-3 h-3 text-foreground" />
        </div>
      </div>

      {/* Heading */}
      <h1
        className="text-4xl mb-3 text-foreground"
        style={{ fontFamily: PACIFICO }}
      >
        Business Hub
      </h1>

      <p
        className="text-sm font-light italic max-w-xs leading-relaxed mb-8"
        style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
      >
        We&apos;re building something amazing for local businesses in your
        neighborhood. Stay tuned — it&apos;s coming soon!
      </p>

      {/* Feature preview chips */}
      <div className="flex flex-wrap gap-2 justify-center mb-10 max-w-sm">
        {[
          "Business Listings",
          "Reviews & Ratings",
          "Local Deals",
          "Business Hours",
          "Direct Messaging",
        ].map((feature) => (
          <span
            key={feature}
            className="px-4 py-1.5 rounded-full text-xs font-semibold"
            style={{
              background: "var(--c-bg)",
              border: "1px solid rgba(130,219,126,0.25)",
              color: GREEN_LIGHT,
              fontFamily: FONT,
            }}
          >
            {feature}
          </span>
        ))}
      </div>

      {/* Notify CTA */}
      <button
        className="flex items-center gap-2 h-12 px-8 rounded-full text-foreground font-semibold text-sm transition-all active:scale-95"
        style={{
          background: GREEN,
          fontFamily: FONT,
          boxShadow: "0 8px 24px rgba(56,142,60,0.3)",
        }}
      >
        <Bell className="w-4 h-4" />
        Notify me when it&apos;s ready
      </button>

      {/* Footer watermark */}
      <p
        className="absolute bottom-8 text-xs opacity-30"
        style={{ color: GREEN_LIGHT, fontFamily: PACIFICO, letterSpacing: "0.15em" }}
      >
        YRDLY
      </p>
    </div>
  );
}
