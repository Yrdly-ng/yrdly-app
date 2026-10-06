# send-push-notification

This is the shared Edge Function for sending push notifications to Expo devices and web/PWA subscriptions across the Yrdly ecosystem.

It also delivers notifications to browser/PWA subscriptions stored in
`public.push_subscriptions`. Configure these Edge Function secrets for Web Push:

- `VAPID_PUBLIC_KEY`: must match `NEXT_PUBLIC_VAPID_PUBLIC_KEY` used by the web app.
- `VAPID_PRIVATE_KEY`: matching private key; keep it only in Supabase secrets.
- `VAPID_SUBJECT`: contact URI, for example `mailto:support@yrdly.ng`.

For example, set them with `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:support@yrdly.ng --project-ref PROJECT_REF`.
The notification sender removes expired browser subscriptions (HTTP 404/410) and
continues sending to other subscriptions if one endpoint has expired.

### Deployment

Because this function is shared between the web and mobile apps, it currently has no automated CI/CD deployment pipeline. 

**If you edit this file, you must manually deploy it** using the Supabase CLI from the `yrdly-app` directory:

```bash
supabase functions deploy send-push-notification --project-ref yoiyqxtpmxnrrbqqidcs
```

*(Note: `yrdly-app` is the canonical owner of this function to keep it aligned with the database migrations. The copy in `yrdly-mobile` has been removed to prevent drift.)*
