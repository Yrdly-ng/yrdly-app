import Link from "next/link";
import { ArrowUpRight, Trophy } from "lucide-react";

export function CampaignBanner({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/campaigns/small-businesses"
      className="group flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-[#14633a] bg-[#f5df16] p-4 text-[#103b24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Trophy size={26} aria-hidden="true" className="shrink-0" />
        <div>
          <p className="font-yrdly-display text-lg font-bold leading-tight">
            Sell More. Win Big.
          </p>
          <p className="mt-1 text-xs sm:text-sm">
            {compact
              ? "Your Businessplace campaign · ₦500,000 for first place"
              : "YRDLY × Small Businesses · 1–30 November · ₦500,000 for first place"}
          </p>
        </div>
      </div>
      <ArrowUpRight size={22} aria-hidden="true" className="shrink-0" />
    </Link>
  );
}
