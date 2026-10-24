# Isolate public profile reads from private accounts

`public_profiles` reads a transactionally synchronized table containing only the previously published profile fields, using invoker permissions and read-only RLS. This avoids a privileged view over private `users` data without weakening account policies or requiring mobile updates. Original user foreign keys keep their deletion actions under private names; deferred projection foreign keys retain the old names for deployed PostgREST embeds, so future migrations must preserve both relationships.
