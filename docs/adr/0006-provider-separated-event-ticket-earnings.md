# Provider-separated ticket collection and organiser withdrawals

Superseded for new ticket collection by [ADR 0007](0007-payluk-for-new-event-ticket-orders.md). Historical Paystack orders retain the provider handling described below.

New event tickets use Paystack main-balance collections and an organiser earnings ledger instead of automatic split settlement. Organiser proceeds become eligible 24 hours after event end and confirmed settlement, while explicit withdrawal requests reserve funds before Transfers; refunds and disputes hold the affected liabilities. Existing Payluk orders retain their original provider because collection, refund and payout obligations cannot safely be migrated by changing a flag. Sandbox can run on the existing project only with an explicit test-on-main flag; test tickets and earnings are labelled and isolated from real wallets; live withdrawals remain gated until settlement, reserve and operating policies are approved.
