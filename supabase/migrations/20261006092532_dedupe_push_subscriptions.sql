-- Keep one browser push subscription per user and endpoint. Earlier client
-- upserts omitted the table's generated primary key, so each refresh created
-- another row for the same endpoint and every push was sent to every copy.
BEGIN;

WITH ranked_subscriptions AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, subscription->>'endpoint'
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_number
  FROM public.push_subscriptions
  WHERE subscription ? 'endpoint'
)
DELETE FROM public.push_subscriptions AS subscriptions
USING ranked_subscriptions AS ranked
WHERE subscriptions.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_user_endpoint
  ON public.push_subscriptions (user_id, (subscription->>'endpoint'))
  WHERE subscription ? 'endpoint';

COMMIT;
