# Full-balance withdrawal fee-tier fix — 3 November 2026

User screenshot: ₦7,125 available, create-intent HTTP400 Insufficient balance, plus repeated rate-limit failures. Read-only Production evidence found the linked seller wallet still contains ₦7,125 main balance and zero escrow. All four matching failed payout requests remained in preparing, not submitted. No user transfer was retried or executed during this investigation. Private account IDs, payout references and raw wallet data remain in a temporary protected directory, not committed here.

## Cause and fix

The previous budgeted flow quoted ₦1,000, used that lower-tier fee to calculate the full-balance transfer, then received an insufficient-balance rejection before it could read the higher-tier fee. This was reproduced with the actual Payluk service and a network-isolated provider fixture. Earlier audit tests expected safe refusal at this boundary rather than completing fee discovery.

New flow allows at most five staging-only intents: on explicit HTTP400 Insufficient balance, probe between the last successful amount and the rejected amount until an authoritative higher-tier quote is available, then stage the final transfer net of that returned fee. Only the final intent is persisted for submission and verified once. Unknown/network/429/other4xx errors stop; no fee guesses, blind verification retries or provider debit exceeding the user's budget. Request count stays bounded; shared-key traffic can still return429 and requires waiting. No fee is subsidized by YRDLY.

The older provider message supplied by the owner uses10.01/100.10/50.05 fees. Current public https://payluk.ng/help/fees describes7.5%VAT instead. Neither schedule is hardcoded. Exact7125 tests cover both:107.50fee→7017.50bank, or100.10fee→7024.90bank. Actual account fee is whatever Payluk returns on the final intent, displayed in the existing confirmation.

## Checks

- New exact7125 fee-tier repro failed before the source fix. Fourteen focused tests now pass, covering preview/execution, both fee schedules, wallet change, network/server/invalid-account errors and429, with no verify on failures and only one verify on success.
- TypeScript and scoped Next lint passed. Full security+fee-tier+reconciliation run passed382tests before adding the two additional older-schedule cases; those additional cases passed separately.
- Full-route payout fixture had pre-existing drift: invalid provider origin, missing bank-list response and campaign receipt dependency. Updated only the mocked boundaries to current transport/configuration and campaign separation. Real payout handlers, services and SQL remain exercised; all7 full-route tests pass, including uncertain-outcome no-retry and explicit seller-only retry.
- Final combined newfee/fullroute/eventworker regression passed35/35 (session21171). No schema changes, provider credentials or mobile source changes required. Web and mobile use this shared backend.

Ship only this fix from isolated product release worktree; preserve original dirt and Payluk email draft. Paid-event production gates remain off. Do not execute a payout for the user; ask them to review the provider-returned fee and explicitly confirm their own withdrawal after deployment is live.
