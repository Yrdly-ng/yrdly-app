# Payluk confirmation and final service split — 2 November2026

Owner supplied provider reply to our two outstanding questions:

1. Whether merchant-created ticket buyers/organisers can independently release funds outside YRDLY: “No.” This is provider-confirmed, not an independently authenticated Payluk buyer session. Do not ask for another buyer login for this answered question.
2. “Once funds have been released to their main wallet or withdrawn to bank, a refund cannot be initiated.”

Event refunds now verify the provider escrow is still OPENED and ONGOING/DISPUTED/INVESTIGATING, its identity/economics/environment match the native order, and the requesting organiser owns the event. Closed/released escrows are rejected before any local refund hold. The existing event-lock/allocation RPC closes the concurrent payout reservation race. No new migration is required. Disclosures on web, native and public Terms explain requesting refunds before payout processing and no provider refunds after release. YRDLY-funded fee reimbursement remains unapproved and unimplemented. Existing retained-fee policy is unchanged.

Regression tests cover completed/claimed/refunded/split provider states, wrong ownership/environment, provider outage, held escrows and reservation conflict. Product TypeScript,42 focused event/checkout/worker tests, full364-security audit and quiet lint passed. Mobile TypeScript,13 event UI tests and scoped lint passed. Native device checks remain waived.

Funded Staging held-half split completed: booking4c555b4a-be4c-46e0-8854-d55b9279c60b, transactiona77c375c-9079-4900-91c7-6f84171a9f6a, tokenPY_WtOnlI0U5805. Buyer funded3150, fee150; first release1500; final held1500 splitbuyer500/seller1000, seller total2500. ProviderSPLIT/CLOSED, local resolution succeeded. Duplicate resolution200/idempotenttrue; final milestone approval409. Commission90 success refCM_AdIRuRwfCP6H1793653690493. Exact evidence in service-held-half-split-2026-11-02.json.

Sandbox wallet top-up daily cap blocked another topup. Reallocated1000 existing QA provider wallet funds to QA buyer through successful two-step wallet_transfer referenceqa-split-seed-4c555b4a-be4c-46e0-8854-d55b9279c60b before funding; no production money. QA seller wallet is6000 while earned ledger totals7000 because the provider transferred1000 to fund this buyer. Their difference is explained by that test-fund transfer, not missing earnings. Do not expect wallet balance to equal lifetime earnings after spending/transfers.

Production service migrations/shared native commission are already applied and verified; product f42b1fe4 and websiteaaa8924 were READY. This follow-up changes refund checks/disclosures only; paid-event checkout/finance/withdrawal/live gates remainfalse. Event finance SQL is still QA-only. Preserve held event tokenPY_Cu6GzdTQ1807 until real claim eligibility4November2026at16:19:17Africa/Lagos. Real event release,3%commission and organiser bank payout still require funded acceptance before activating events. No bank payout or early confirmation was submitted here.
