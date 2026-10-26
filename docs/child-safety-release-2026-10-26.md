# Child-safety production release

The selected child-safety migrations were installed on production project
`yoiyqxtpmxnrrbqqidcs` using the procedure established in
`docs/production-release.md`. Earlier timestamp differences reflect selected
production deployments and are not a reason to replay the full migration folder.
No old history entries were repaired, deleted, or marked applied.

`qa-scripts/prepare-child-safety-release.cjs` prepares bounded, atomic SQL for
exactly three migrations. It checks the reviewed original session gate and absent
target objects/history, locks migration bookkeeping, removes only outer
transaction wrappers, executes the migrations, verifies client restrictions,
and records exact original SQL with version/name in the same transaction.
The rehearsal ended with ROLLBACK; a separate query confirmed the original gate,
absent tables, and zero new history rows before COMMIT was used.

Production readback matched these source MD5 checksums:

| Version | MD5 |
| --- | --- |
| `20261026170603` | `dabac5e00b0656c9f07676efc1199a83` |
| `20261026170833` | `7d3e9eb560f60ce55e4f7179eed1c111` |
| `20261026180520` | `0bec3fdcd452a50626e333f428fad58e` |

The session gate retains the existing owner and grants. Its owner bypasses RLS;
the profile join preserves onboarding before a profile exists. Existing profiles
marked suspended/banned fail the gate. Report post hiding requires non-null open
status, child-safety category, and linked post. PGlite regression coverage passes
for these cases. The new audit tables enable RLS and deny anon/authenticated
access, and both RPCs require service-role access plus validated admin identity.
Production security advisors reported no errors. No moderation actions were
taken on customer accounts or content during deployment; both audit tables were
empty immediately after the release.

The public child-safety and privacy pages were published separately and return
HTTP 200. Signed mobile artifacts, installed-device acceptance, store declarations,
staff operational coverage, actual media removal, and account-erasure acceptance
remain separate release evidence. Schema deployment does not certify them.
