# Withdrawal verification rate-limit follow-up — 3 November 2026

The owner reported a second withdrawal stuck processing after the fee-tier fix. Production read-only diagnosis found a submitted-stage payout whose verify call returned HTTP429. Provider exact-reference history was empty and the customer main wallet remained7125, escrow0. The earlier fix solved the quote-tier issue but did not account for preview/account/balance requests exhausting the key-wide quota before verify; that omission is acknowledged.

## Remediation

An explicit parsed provider429 with numeric status429 and Too many request(s) now returns a retryable failure, not unknown processing. Persisted submission stage is reset to preparing by CAS only for this explicit rejection. Timeouts, non-JSON errors, lost responses, provider pending and server failures remain uncertain/reserved. Never automatically replay a bank transfer.

Capture the provider's quota remaining/reset headers. If the latest response says zero requests remain, reject before persisting submission or calling verify, returning Retry-After. This is a local preflight hint, not a cross-worker global guarantee; explicit429 remains handled because shared-key traffic can consume quota concurrently.

The existing stuck Production payout was manually reconciled to failed/preparing by an exact-reference/status/stage/error CAS after two read-only checks showed no matching provider history and the full7125 wallet unchanged. The saved original rejection was HTTP429. An immutable payment_reconciliation_flags entry records the reason and exact reference before the update. No create-intent, verify, refund, wallet transfer or bank payment was submitted by this remediation. User must request/confirm their own withdrawal after deployment. Private customer/payout identities are kept out of this handoff.

## Verification

Focused provider tests cover parsed verify429, known exhausted quota before submission, both fee schedules and no automatic execution/replay. Full payout-route test checks reservation release and preparing stage on explicit429, while timeout test retains processing and permits no second payment. Broader security/reconciliation checks and TypeScript/lint are being completed; record terminal results before release.

No migration or mobile release is required: web and mobile share the backend. Production paid events remain off. Preserve original worktrees and the modified Payluk draft.

Local reconciliation evidence: exact reference matched the recorded HTTP429 verify rejection; fresh exact-reference history was empty and wallet7125/escrow0. Audit was saved before CAS. Payout is nowfailed/preparing, notprocessing. No user payment was executed. Focused15fee/quota tests passed81591, two parsed/nonJSON429 security tests passed72790; TypeScript completed before full-route56412; lint55512 clean. Full payout-route results are being collected. One broad run used the earlier faulty exhausted-quota fixture and reported that single fixture failure; it was corrected and focused15rerun passed. No production code behavior was changed to satisfy that fixture.

Final full-route/SQL tests56412 passed8/8, including actual explicit429stage reset and unchanged ambiguous-timeout guard. Combined fee/quota+route run66014 passed23/23. Ready to ship this follow-up without schema/mobile changes.
