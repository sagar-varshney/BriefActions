# Encrypted backup and recovery

`scripts/backup.py` streams a consistent, repeatable-read PostgreSQL snapshot of
all application accounts into an authenticated AES-256-GCM file. It includes
events, original inputs/evidence, corrections, confirmed plans, annotation reviews,
server-saved drafts, task progress events, frozen splits, comparisons, and deletion markers. Only encrypted
bytes are written during backup; output files have mode 0600 and cannot overwrite
an existing file. Files are limited to 8 GiB and records to 64 MiB.

This is an **application data backup**. Supabase Auth users, OAuth settings, SMTP,
provider roles, storage objects, and point-in-time recovery are outside its scope.
Keep provider recovery procedures and encryption keys separately. Losing the key
makes a backup unrecoverable. Database owners/account UUIDs stay unchanged: account
access requires the matching Auth users, not newly registered replacement accounts.

## Setup and scheduled backups

1. Apply all migrations in `deploy/migrations/` in filename order, including
   `003_backup_metadata.sql`. It creates an administrator-only stable database ID
   used to prevent mixing backups and erasure ledgers from different projects.
2. Install `requirements-backup.txt` in a private operator environment. Use Python
   3.10+ and a database administrator connection with `BYPASSRLS` or superuser
   privileges. The tool rejects the restricted `flow_app` role to avoid quietly
   backing up only one account. Remote connections require TLS (`sslmode=require`
   or certificate verification); session/direct connections are recommended.
3. Run `python scripts/backup.py generate-key` locally once and save the printed key
   in a password manager. Never commit it or put it in a browser/build variable.
4. In GitHub repository **Actions secrets**, add `FLOW_BACKUP_KEY` and
   `FLOW_BACKUP_DATABASE_URL` (source administrator connection URI with TLS).
   Set the Actions variable `FLOW_BACKUPS_ENABLED` to `true`.
5. Run **Encrypted application backup** manually first. The workflow then runs
   daily around 03:17 UTC (08:47 IST; GitHub schedules can be delayed). It uploads
   only encrypted `.flowbak` files and retains artifacts for seven days. Check
   Actions failures and periodically download/test a backup. For longer retention,
   archive encrypted files in controlled storage and define an expiry policy.

**Scheduling is inactive until the variable and secrets are configured.** Nothing
in this repository configures live credentials, deploys the app, or enables backups
automatically. Seven-day artifact retention is not indefinite disaster recovery.
GitHub Actions/artifact quotas and provider availability still apply.

For manual operation, export the same two environment variables in a private shell
without putting credentials in command arguments or logs, then:

```sh
python scripts/backup.py backup --output application.flowbak
python scripts/backup.py ledger --output erasures.flowbak
```

The command prints success or sanitized errors, never database URLs, keys, or row
content. `.gitignore` and `.dockerignore` exclude backup files. These files contain
private information even when encrypted; restrict access and retention accordingly.

## Restore into an isolated empty database

1. Use the repository version whose migration hashes match the backup. Provision
   a **separate empty database** and apply those migrations in order. Do not point
   the restore tool at the active app database. Keep the matching provider Auth
   users available, or arrange provider Auth restoration separately.
2. Pause application writes before the final recovery cutover. If the source
   database is available, create a **fresh** erasure ledger from it using `ledger`.
   The ledger bundled alongside an old backup only covers erasures known at that
   time. Fetch a new one to cover subsequent deletions, with no intervening writes
   before cutover. This tool checks project identity and that the ledger does not
   predate the backup; it cannot prove that a supplied ledger is the latest one.
3. Set `FLOW_RESTORE_DATABASE_URL` to the new target's administrator URI and keep
   `FLOW_BACKUP_KEY` set to the original key. The source variable is separate.
4. Restore:

```sh
python scripts/backup.py restore --input application.flowbak \
  --ledger fresh-erasures.flowbak --confirm-empty-target
```

The entire file is authenticated before parsing or database writes. Restore uses
fixed table/column lists and parameterized inserts; no SQL from a backup is
executed. A fresh target is locked and checked for any application rows. The
restore runs in one transaction, restores original event IDs and the sequence,
and applies the supplied ledger through the app's owner-scoped purge functions.
Later input erasures remove dependent snapshots/reports; account erasures remain
paused and cannot be reactivated by stale requests. Wrong keys, damaged files,
foreign/older ledgers, schema mismatches, and nonempty targets are rejected.

If the source and every fresh ledger are unavailable, disaster recovery requires
the explicit `--acknowledge-missing-erasure-ledger` flag instead of `--ledger`.
**That recovery can reintroduce data deleted since the backup.** Keep the target
isolated, reconcile known deletion requests, and verify account access before
opening it. Older encrypted backups and downloaded exports remain separate copies;
the live app cannot remotely erase them. Expire them under your retention policy.

Decryption uses a private temporary file, removed on exit; use an operator machine
with protected/encrypted temporary storage. Verify recovered plans, evidence,
reviews/drafts, account isolation and deletion markers before changing the app's
connection URL. Apply later migrations after restoration when upgrading versions.

## Tested recovery drill

```sh
FLOW_TEST_DATABASE_URL=postgresql://... python scripts/test_backup_postgres.py
```

Use a disposable PostgreSQL test server with database-creation permission. The
drill creates and drops two uniquely named test databases. It backs up synthetic
accounts, restores into an empty target, checks immutable history, task progress, drafts, reviews,
sequences and account isolation, and verifies erasures made after the backup,
dependent snapshot removal, corruption rejection and nonempty-target protection.
CI runs this drill on PostgreSQL 17; no live transcripts or credentials are used.
