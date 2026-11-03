# Use Payluk escrow for new event ticket orders

Supersedes ADR 0006 for new ticket collection: the owner selected Payluk after Paystack required a licensed holding arrangement for conditional organiser proceeds, and Payluk confirmed the event model is supported by its API. New ticket orders use Payluk escrow with native merchant commission, provider delivery windows rounded conservatively beyond the event end, and organizer-requested withdrawals after the event hold and refund/dispute checks; Paystack is retained for subscriptions and recovery of historical ticket orders, whose provider and financial obligations remain immutable.

The local implementation is staging-only until separate release approval, migration application and provider validation. Ordinary buyer confirmation routes cannot release ticket escrows early; unresolved refund requests hold withdrawal and require provider-backed resolution rather than a local refunded flag.
