"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Check, Share2, Users, Gift, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";

const FONT = "var(--yrdly-font-body)";
const RALEWAY = "var(--yrdly-font-display)";

export default function InviteFriendsPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const inviteCode = profile?.username || user?.id?.slice(0, 8) || "invite";
  const inviteLink = `https://app.yrdly.ng/invite/${inviteCode}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({ title: "Invite link copied!" });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join me on Yrdly!",
          text: "Connect with neighbors, buy & sell locally, and explore local events on Yrdly.",
          url: inviteLink,
        });
      } catch (err) {
        console.error(err);
      }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="min-h-screen bg-[var(--yrdly-dark)] text-foreground pb-20 font-yrdly-body">
      <header className="lg:hidden sticky top-0 z-30 bg-[var(--yrdly-dark)]/80 backdrop-blur-md border-b border-[var(--yrdly-glass-border)] px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-card transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-xl font-bold text-foreground font-yrdly-display">
          Invite Friends
        </h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Banner */}
        <div
          className="p-6 rounded-3xl border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl text-center space-y-4 shadow-xl relative overflow-hidden font-yrdly-body"
        >
          <div className="w-14 h-14 rounded-full bg-primary/20 text-primary flex items-center justify-center mx-auto">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-foreground font-yrdly-display">
              Bring your neighborhood together
            </h2>
            <p className="mt-1 text-sm text-[var(--yrdly-label)] max-w-sm mx-auto font-yrdly-body">
              Invite your friends and neighbors to join Yrdly and build a safer, closer community.
            </p>
          </div>
        </div>

        {/* Invite Link Box */}
        <div className="p-5 rounded-2xl bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] space-y-3 font-yrdly-body">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--yrdly-label)] block font-yrdly-body">
            Your Personal Invite Link
          </label>
          <div className="flex items-center gap-2 font-yrdly-body">
            <input
              type="text"
              readOnly
              value={inviteLink}
              className="flex-1 px-4 py-3 rounded-xl bg-background/50 border border-[var(--yrdly-glass-border)] text-sm font-medium text-foreground focus:outline-none font-yrdly-body"
            />
            <button
              onClick={handleCopy}
              className="p-3 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 transition-all shrink-0"
            >
              {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>

          <button
            onClick={handleShare}
            className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md hover:opacity-90 transition-all flex items-center justify-center gap-2 mt-2 font-yrdly-body"
          >
            <Share2 className="w-4 h-4" /> Share Invite Link
          </button>
        </div>

        {/* Benefits List */}
        <div className="p-6 rounded-2xl bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] space-y-4 font-yrdly-body">
          <h3 className="text-base font-bold text-foreground font-yrdly-display">
            Why invite your neighbors?
          </h3>
          <div className="space-y-3 text-xs leading-relaxed font-yrdly-body">
            <div className="flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-foreground">Trusted Marketplace</p>
                <p className="text-[var(--yrdly-label)]">Buy and sell items with people in your verified local area.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Gift className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-foreground">Local Events & Gatherings</p>
                <p className="text-[var(--yrdly-label)]">Never miss neighborhood events, yard sales, or community meetings.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
