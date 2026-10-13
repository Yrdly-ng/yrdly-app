# Private chat and report media rollout

This is a staged change for the shared backend `yoiyqxtpmxnrrbqqidcs`.
Do not apply the bucket migration before the matching web deployment and
compatible mobile clients are verified.

1. Deploy the web signing endpoint and renderers. Keep
   `NEXT_PUBLIC_PRIVATE_MEDIA_REFERENCES` unset or `false` initially. Uploads keep
   their historical project URL format, while the web authorizes those URLs by
   extracting their bucket and object path. No existing attachment row is rewritten.
2. Verify chat image/video upload, display, downloads and report attachments with
   an author, another conversation member, a non-member and an admin. Check old
   attachments, expired signed URLs, video range requests and account changes.
   Verify that all other shared clients can read private media too. Private
   images deliberately bypass the shared Next.js image optimizer.
3. Apply `launch_lockdown_a` after its matching code deployment. Then apply
   `20261010054000_private_chat_report_media.sql` explicitly, rather than using a
   generic migration push. The four additive audit prerequisites already have
   live versions different from their local draft filenames; see `AUDIT_FIX_STATUS.md`.
   The private media migration checks for unmapped historical objects before
   changing permissions. It preserves object names and restricts chat access to
   members, modification to member owners, and report reads to the author/admin.
4. Check that unauthenticated public object URLs fail, members/authors can obtain
   five-minute signed URLs, outsiders cannot, and other users cannot overwrite or
   delete an attachment. Signed responses are private/no-store. The web refreshes
   URLs after four minutes and discards them on account changes.
5. Optionally set `NEXT_PUBLIC_PRIVATE_MEDIA_REFERENCES=true` and redeploy once
   every shared client accepts `storage://bucket/path` references. Existing
   project-host URLs remain resolvable through the signer after the bucket flip;
   the new reference format is not required to make the existing objects private.

The migration is drafted and **has not been applied**. Live bucket privacy and
full client behavior require the rollout checks above. Previously disclosed
public attachments cannot be recalled from third-party caches or copies.
