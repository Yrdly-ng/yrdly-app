"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Shield, Heart, ShoppingBag, MapPin, Lock, AlertTriangle } from "lucide-react";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-jersey25)";

const GUIDELINES = [
  {
    icon: Heart,
    title: "Be Respectful & Kind",
    desc: "Treat all community members with courtesy and fairness. Harassment, hate speech, or discrimination will not be tolerated.",
  },
  {
    icon: ShoppingBag,
    title: "Honest Commerce",
    desc: "List items with clear photos and accurate descriptions. Honor agreed prices and fulfill meetup or delivery commitments promptly.",
  },
  {
    icon: MapPin,
    title: "Keep it Local & Relevant",
    desc: "Post content and events that directly matter to your neighborhood or surrounding area to keep the feed useful for everyone.",
  },
  {
    icon: Lock,
    title: "Protect Privacy & Safety",
    desc: "Never share private contact details, exact home addresses, or personal financial information in public posts or open comment sections.",
  },
  {
    icon: AlertTriangle,
    title: "Report, Don't Retaliate",
    desc: "If you encounter suspicious behavior, spam, or a safety issue, use the report button immediately so moderators can handle it.",
  },
];

export default function GuidelinesPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-card transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
          Community Guidelines
        </h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div className="p-6 rounded-3xl bg-card border border-border/40 space-y-2 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/20 text-primary flex items-center justify-center mx-auto mb-3">
            <Shield className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-extrabold text-foreground" style={{ fontFamily: RALEWAY }}>
            Our Neighborhood Standards
          </h2>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto" style={{ fontFamily: FONT }}>
            Yrdly is built on trust, transparency, and safety. Please adhere to these guidelines at all times.
          </p>
        </div>

        <div className="space-y-3">
          {GUIDELINES.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="p-5 rounded-2xl bg-card border border-border/40 space-y-2 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
                    {item.title}
                  </h3>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground pl-12" style={{ fontFamily: FONT }}>
                  {item.desc}
                </p>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
