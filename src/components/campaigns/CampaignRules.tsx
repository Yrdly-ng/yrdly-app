export const campaignRules = [
  [
    "Where sales count",
    "Paid product orders from the Businessplace directory only. Personal marketplace listings, services, event tickets, free items and off-platform payments do not qualify.",
  ],
  [
    "Join before you sell",
    "Existing and new businesses can apply. Enrollment requires approval, with one participating business per owner. The Google Form collects interest; it does not enroll your business.",
  ],
  [
    "One completed order. One sale.",
    "Quantity and naira value do not change the count. The buyer must confirm receipt and the payment provider must confirm release. Payment alone, marking a product sold and timed automatic claims do not count.",
  ],
  [
    "The November window",
    "Orders must be created after approval and both created and completed between 1 November 2026 at 00:00 and the end of 30 November, Nigeria time (Africa/Lagos). Earlier orders do not count.",
  ],
  [
    "Refunds and disputes",
    "Pending refunds, disputes and uncertain payment outcomes are held out of the count. Any confirmed refund, including a partial refund, or reversal removes that order. A resolved case counts only if it meets every rule.",
  ],
  [
    "Fair competition",
    "Self-purchases are excluded. Related-account and suspicious purchases are reviewed with evidence; genuine repeat customers are allowed. Adjustments require a recorded reason.",
  ],
  [
    "First place and ties",
    "The highest completed-sale count wins ₦500,000. Equal counts share rank; verified businesses tied for first place split the ₦500,000 equally, reconciled in kobo so the total remains exactly ₦500,000. Revenue is never a tie-breaker.",
  ],
  [
    "Results under review",
    "There is a seven-day review after closing before winners are announced. Unresolved cases can delay final results. Leaderboard positions are provisional until verification is complete.",
  ],
] as const;

export function CampaignRules() {
  return (
    <section
      id="rules"
      aria-labelledby="campaign-rules-title"
      className="rounded-3xl border border-border bg-card p-5 sm:p-7"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Know the rules
      </p>
      <h2
        id="campaign-rules-title"
        className="mt-2 font-yrdly-display text-2xl font-bold"
      >
        A fair shot for every business.
      </h2>
      <div className="mt-5 divide-y divide-border">
        {campaignRules.map(([title, description], index) => (
          <details key={title} className="group py-4" open={index === 0}>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              {title}
            </summary>
            <p className="max-w-3xl pb-2 text-sm leading-7 text-muted-foreground">
              {description}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
