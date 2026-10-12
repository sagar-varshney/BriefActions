# Deploying Productivity Flow Engine

The hosted app serves React and a Node API from one origin. Node runs the Python
extraction engine; Postgres stores account-scoped history and annotation drafts.
Supabase handles sign-in. The separate legacy FastAPI/RAG app is not deployed.

## Recommended free starting point

Use **Render's free Docker web service + Supabase's free Auth/Postgres project**.
Docker packages the application; a hosting service runs that package.

Provider limits checked on 2026-10-12:

| Option | Fit for this application | Free limits that matter |
| --- | --- | --- |
| Render + Supabase | Runs the current Node/Python application with external persistent storage | Render sleeps after 15 idle minutes and has 750 free instance hours per workspace/month. Supabase includes a 500 MB database and 50,000 monthly active auth users; inactive free projects can pause after a week. |
| Railway | Can run the Docker application and managed storage | $5 trial credit for up to 30 days, then $1/month free credit. This is a usage budget, not unlimited hosting. |
| Vercel | Suitable for a separately hosted React frontend | The current long-running Node server launching Python workers would need a function architecture rewrite. Hosting only the frontend still needs a backend. |
| Cloudflare | Suitable for static assets and a redesigned Workers backend | Full Node/Python containers require a paid Workers plan. The free Workers runtime is not a drop-in host for this server. |

Sources: [Render](https://render.com/docs/free),
[Supabase](https://supabase.com/pricing),
[Railway](https://docs.railway.com/pricing/free-trial),
[Vercel runtimes](https://vercel.com/docs/functions/runtimes),
[Cloudflare Containers](https://developers.cloudflare.com/containers/pricing/).

Free plans are useful for a low-traffic launch, but include cold starts, quotas,
and no uptime guarantee. Supabase Free does not include automatic backups;
schedule independent database exports and test restoration before retaining
important meeting records. Provider limits and available plans can change.

## Set up Supabase

1. Create a project. Keep the database password server-side.
2. Run `deploy/migrations/001_accounts.sql` in the project's SQL editor as the
   database administrator. It creates a private `flow` schema and restricted
   `flow_app` role. Never expose that schema through the browser Data API.
3. In Auth, enable the GitHub OAuth provider and configure a GitHub OAuth app.
   Use Supabase's callback URL for the GitHub app. Set Supabase's Site URL and
   allowed redirect URL to the exact deployed app origin.
4. Copy the project's URL and **publishable key**. A legacy `anon` key is also
   supported; never use a service-role or secret key in that setting.
5. Copy the **session pooler** Postgres connection URI from Connect. Add
   `sslmode=require` and URL-encode special characters in the password. The app
   uses short-lived connections with prepared statements disabled.
6. Optional email links: configure custom SMTP, email templates, and redirect
   allowlists first, then set `FLOW_EMAIL_SIGNIN=true`. Supabase's built-in mail
   service is restricted and is not appropriate for public email delivery.

See [GitHub OAuth setup](https://supabase.com/docs/guides/auth/social-login/auth-github),
[database connections](https://supabase.com/docs/guides/database/connecting-to-postgres),
[SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp), and
[redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Set up Render

1. Connect this GitHub repository and select the Docker runtime/free plan, or
   use the included `render.yaml` Blueprint.
2. Configure the environment values listed in `.env.example` in Render's
   dashboard. `PUBLIC_ORIGIN` must equal the app's HTTPS origin, without a
   trailing slash. The image already sets production mode and binds `0.0.0.0`.
3. Keep `FLOW_DATABASE_URL` in the server environment only. Do not use `VITE_`
   prefixes for secrets. React obtains only public auth configuration at runtime,
   so changing hosts does not require embedding a localhost API URL in a build.
4. Deploy and check `/api/health`. It verifies the Python runtime and an
   account-scoped database query. It returns no transcripts or credentials.
5. Verify sign-in using two real accounts: create a run in one, confirm the
   other has empty history and cannot retrieve that run ID or its exports.
   Sign out, sign back in, and confirm drafts and history survive a redeploy.

The production server refuses to run without authentication, persistent database
configuration, and an HTTPS app origin. Do not force `FLOW_AUTH_MODE=local` on
a public host. The local workspace remains available through `pnpm dev` without
Supabase; hosted accounts do not inherit that local database or its browser drafts.
Existing local transcripts are preserved on your machine and are not uploaded
automatically.

## Other Docker hosts

```sh
docker build -t productivity-flow-engine .
docker run --env-file .env.production -p 3001:3001 productivity-flow-engine
```

Put TLS and your public domain in front of the container. Configure
`PUBLIC_ORIGIN` accordingly. Use external Postgres rather than an ephemeral
container filesystem. `.dockerignore` excludes local databases, secrets,
private evaluation data, tests, and the legacy RAG backend.

## Data and access behavior

- Every API request is verified with Supabase Auth. Client-supplied account IDs
  cannot select the storage owner. No public transcript/history routes exist.
- Database transactions switch to the non-owner, non-superuser `flow_app` role.
  Row security checks the verified account ID for both reads and writes. The
  restricted role can append events, but cannot update or delete history events.
- Account data is private. Annotation reviewer names and independence remain
  self-attested labels inside that account; team sharing and authenticated
  multi-person annotation studies are not implemented.
- Account browser keys are separate. They retain unfinished drafts on the same
  browser; server-saved drafts and history are available across devices. Use
  your own browser profile for private material on shared computers.
- Analysis is limited to 10 requests/account/minute, general APIs to 90,
  worker concurrency to two, and requests to 1 MB. Postgres limits history
  payloads to 25 MB/account and annotation drafts to 5 MB/account. These limits
  bound growth per account, not the total number of public signups. Monitor
  provider storage quotas; enable auth CAPTCHA/rate limits in Supabase for a
  public launch. The SDK and auth provider handle login rate limits.
- CSV/JSON exports require the same authenticated account. Responses carrying
  account data are never cached. Logs do not intentionally record transcripts.
- The 84 bundled synthetic examples and retained model reports are reference
  material. Their authorship and metric limitations remain in an expandable
  provenance section; deployment does not validate them as real-meeting accuracy.

For support-driven deletion, an administrator can remove a selected account's
rows from the private schema using its Supabase user UUID. Removing the auth
user alone does not delete this application data. Back up/export as appropriate,
and restrict administrative credentials. A self-service account deletion flow
and organizational sharing require separate implementation.

## Verification

```sh
python -m unittest discover -s tests -v
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
FLOW_TEST_DATABASE_URL=postgresql://... python scripts/test_postgres.py
```

The final command installs the migration and creates isolated test accounts in
a **disposable test database**. Never use the live production URI for CI.
GitHub CI tests the full workflow suite on SQLite and real Postgres, checks RLS
against forged/missing owners, verifies desktop/mobile and themes, and builds
and smoke-tests the production Docker image. Test authentication fixtures do
not replace checking your live Supabase OAuth settings before launch.
