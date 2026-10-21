# First deployment: Render + Supabase

This starts from no hosting accounts. The code is prepared and tested; creating
accounts, configuring live providers and verifying a public URL remain separate
steps. Follow the current [hosting comparison](deployment.md) for limits and
sources. The free plans suit an initial pilot, with sleeping/pausing and quotas.

## 1. Create the accounts and empty database

Create accounts at [Supabase](https://supabase.com/dashboard) and
[Render](https://dashboard.render.com/), preferably using GitHub. Connect their
integrations in the coding assistant if you want it to operate the providers
through connected tools. Account sign-in and permissions still belong to you.
No passwords or secret keys need to be pasted in chat.

In Supabase choose a Free organization, project name **BriefActions**, and
Singapore (`ap-southeast-1`) if available. This keeps the database near the
prepared Render service. Save the database password in your password manager.
Wait until ready, then run these files in **SQL Editor**, one at a time, in order:

1. `deploy/migrations/001_accounts.sql`
2. `deploy/migrations/002_data_controls.sql`
3. `deploy/migrations/003_backup_metadata.sql`
4. `deploy/migrations/004_plan_updates.sql`
5. `deploy/migrations/005_series_agenda_erasure.sql`

Use the project administrator editor on this new project. Keep `flow` private
and outside the browser Data API. Never run the disposable CI database test
scripts against this database. Local and sample meetings are not uploaded.

## 2. Create the Render service

Choose **New → Blueprint**, connect
[`sagar-varshney/BriefActions`](https://github.com/sagar-varshney/BriefActions),
and choose `main`. The prepared service uses **Docker / Free / Singapore**, one
analysis worker, `/api/live` health checks and automatic application deploys only
after CI checks pass. Review those values before deploying; no paid resources
are declared. Email sign-in stays disabled until custom SMTP is configured.

Copy these values directly from Supabase into Render's server environment:

| Render setting | Supabase source |
| --- | --- |
| `SUPABASE_URL` | Project URL, `https://PROJECT-REF.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable API key, beginning `sb_publishable_` |
| `SUPABASE_SECRET_KEY` | Server-only secret key, beginning `sb_secret_`; used for account deletion |
| `FLOW_DATABASE_URL` | Connect → Session pooler URI, with the password URL-encoded and `sslmode=require` appended |

Keep secret values in provider settings or your password manager, never browser
variables or `VITE_` settings. Do not use SQLite or a temporary Render database.
Leave `PUBLIC_ORIGIN` unset: the server uses Render's assigned HTTPS URL. For a
custom domain, set that exact HTTPS origin explicitly. Wait for the deploy to
be live and record the actual URL and deployed commit; the hostname may differ
from the requested service name. `/api/live` alone does not establish readiness.

## 3. Configure GitHub sign-in

Register a new OAuth App in [GitHub OAuth Apps](https://github.com/settings/developers):

- Name: **BriefActions**.
- Homepage URL: the Render app's actual HTTPS origin.
- Authorization callback: `https://PROJECT-REF.supabase.co/auth/v1/callback`.

Generate a client secret. Enter the Client ID and secret in Supabase →
Authentication → Sign In / Providers → GitHub, then enable the provider.
In Supabase Authentication URL Configuration, set:

- Site URL: the Render app's exact HTTPS origin.
- Allowed redirect: `https://YOUR-APP-HOST/auth/callback`.
- Also allow the exact root origin for older links; avoid wildcards.

GitHub's callback points to Supabase; Supabase's redirect points back to the app.
They are different URLs. See the official [GitHub provider setup](https://supabase.com/docs/guides/auth/social-login/auth-github)
and [redirect guidance](https://supabase.com/docs/guides/auth/redirect-urls).

## 4. Verify before sharing

From this repository, with Node 24+, replace the hostname and run:

```sh
node scripts/check_deployment.mjs live https://YOUR-APP-HOST
```

No token is required; the command checks rejected writes only and creates no
users or tasks. All checks must pass. If still deploying or starting from sleep,
let the service finish starting and rerun. It does not prove real sign-in works.

Then use invented data to check real GitHub sign-in, review/confirmation, deadline
and progress updates, direct private links, sign-out/sign-in and reload. In a
separate browser profile, another account must have empty history and be unable
to open the first account's meeting/export. Redeploy the same commit and verify
saved reviews, tasks, series and agendas persist. Test transcript/account deletion,
including saved agenda copies. Configure and test [encrypted backup recovery](backups.md)
into a separate empty database; retain the encryption key separately.

Record the URL, commit, provider identifiers and results of smoke, sign-in,
two-account, persistence, deletion and recovery checks. Keep unfinished items
pending. No public deployment completion is claimed until these live checks run.
