export const campaignRules = [
  [
    "Where sales count",
    "Paid product orders from the Businessplace directory only. Personal marketplace listings, services, event tickets, free items and off-platform payments do not qualify.",
  ],
  [
    "Every eligible business is in",
    "When you create an eligible product business in Businessplace, it joins the campaign automatically. Existing eligible product businesses are included too.",
  ],
  [
    "One completed order. One sale.",
    "Once a customer confirms they received the product and the payment is complete, the order adds one sale. Buying more items at once does not add extra points. A payment by itself or marking an item sold is not enough.",
  ],
  [
    "The November window",
    "An order must be placed and completed between 1 and 30 November 2026, Nigeria time. Earlier or later orders do not count.",
  ],
  [
    "Refunds and disputes",
    "An order being refunded or disputed will not count while it is being sorted out. A refunded or reversed order will not count.",
  ],
  [
    "Fair competition",
    "You cannot count an order you placed with your own business. We may check sales that look unusual. Real repeat customers are welcome.",
  ],
  [
    "First place and ties",
    "The business with the most completed sales wins ₦500,000. Businesses tied for first place share the prize equally. The amount you sell never changes your rank.",
  ],
  [
    "Results under review",
    "After November ends, we will check the final sales for up to seven days before announcing the winner. The live leaderboard can change while we finish those checks.",
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
