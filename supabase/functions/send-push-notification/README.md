# send-push-notification

This is the shared Edge Function for sending push notifications via Expo across the Yrdly ecosystem. 

### Deployment

Because this function is shared between the web and mobile apps, it currently has no automated CI/CD deployment pipeline. 

**If you edit this file, you must manually deploy it** using the Supabase CLI from the `yrdly-app` directory:

```bash
supabase functions deploy send-push-notification --project-ref yoiyqxtpmxnrrbqqidcs
```

*(Note: `yrdly-app` is the canonical owner of this function to keep it aligned with the database migrations. The copy in `yrdly-mobile` has been removed to prevent drift.)*
