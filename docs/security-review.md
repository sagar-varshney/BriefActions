# Security review — 29 October 2026

Scope: the publicly deployed React/Node/Python architecture, repository history,
build and dependency configuration, and read-only Supabase security metadata.
Application tests use invented transcripts and isolated databases. No private
production transcripts were read or modified. These changes remain unreleased
until their pull request is merged and the resulting deployment is verified.

## Findings and changes

| Area | Review result |
| --- | --- |
| Spreadsheet exports | Confirmed CSV formula-injection gap. Every exported cell now passes through a spreadsheet-text guard; CSV quotes all fields. Formula prefixes, leading whitespace/BOMs, full-width operators and leading tab/newline controls are covered. Original history, JSON and transcript evidence remain unchanged. |
| Public files | Added an explicit public asset-type allowlist. Hidden files, Vite's internal manifest, source maps, database/backup files, malformed paths and symlinks escaping the build directory are rejected. Valid assets and workspace deep links still load. |
| Request handling | Enforced the exact JSON media type (with optional parameters); compressed bodies are unsupported. Both declared-length and chunked bodies are bounded at 1 MB. HTTP headers are capped at 16 KiB; receipt of headers/body has explicit time limits. |
| Browser protections | Retained restrictive CSP, anti-framing, no-referrer, nosniff, HTTPS HSTS and private `no-store` responses. Added `object-src 'none'` and disabled unused camera, microphone and geolocation permissions. |
| Secret detection | Gitleaks runs over all fetched reachable Git history with fully redacted output and its standard rules plus a Supabase server-key rule. A throwaway-repository regression detects an invented secret even after its file is deleted. Scanner binaries are version- and SHA-256-pinned. |
| Dependency checks | `pnpm audit` checks the Node lockfile including build tools. `pip-audit` checks `requirements-hosted.txt`, the exact Python snapshot installed by Docker and application CI. The public Supabase SDK version is pinned explicitly. |
| Update proposals | Dependabot checks JavaScript, active Python requirements and GitHub Actions weekly, with at most three open version-update PRs per ecosystem. The undeployed RAG requirements are excluded. Updates still need review and passing CI; auto-merge is not enabled. |
| CI enforcement | The existing required application check depends on security scans and explicitly fails if they fail or are cancelled. A skipped dependent job cannot accidentally satisfy that required check. Scans also run weekly and on manual dispatch. Workflow permissions remain read-only; checkout credentials are not persisted. |
| Disclosure | Free GitHub private vulnerability reporting enabled; [security policy](../SECURITY.md) added. |

## Existing protections inspected

- Public server startup fails closed without managed authentication, persistent
  Postgres and a configured HTTPS origin. Auth configuration returns only the
  project's public URL and publishable/anon key, never server secrets.
- The server calls Supabase `getUser(token)` for authoritative identity. Invalid
  and anonymous identities are rejected; provider outages cannot open a workspace.
  User-editable metadata never determines the account scope. Browser session
  objects are used to send credentials, not as the server's authorization decision.
- Account identity comes from the verifier, not a request's `owner_id`. Existing
  regression tests exercise two-account read/write/export isolation, forged
  ownership, deletion, and stale/pending-write recovery.
- The private `flow` schema is not a browser data API. Live database metadata
  confirms forced RLS on events, annotation drafts, deleted-input markers and
  account lifecycle records. `anon` and `authenticated` have no direct SELECT
  privilege on any application table. The administrator-only backup identity
  table deliberately has no user access or RLS policy.
- Each Postgres transaction switches to a restricted role and sets its verified
  account scope. Queries bind user input as parameters. Cached connections never
  preserve an account transaction across users; ambiguous writes are not replayed.
- Browser writes are checked against the configured app origin, and the server
  does not grant permissive CORS access. Bearer credentials are required on private
  API routes and downloads. Account/analysis rate limits and authentication/worker
  concurrency limits already bound normal app usage.
- Transcripts and task text render as React text. A browser regression verifies
  stored HTML/script-shaped input in transcript, title, task and owner fields,
  including reload, with CSP bypassed to test escaping independently of CSP.
- Request failures and telemetry omit private exception text, transcripts and
  credentials. The production image runs as an unprivileged user, excludes env
  files, local databases and the legacy FastAPI/RAG app, and serves only `dist/`.
- BriefActions does not accept or hash passwords itself. Supabase handles GitHub
  OAuth and optional email links; no custom password store is introduced.

## Audit observations

On 29 October 2026, the Node lockfile and resolved/pinned hosted Python dependencies
reported **no known vulnerability advisories**. The pre-change full reachable
Git-history scan reported **no detected secrets**. This is a time-bounded finding,
not proof that every credential pattern or vulnerability is detectable. The new
checks repeat on each push/PR through CI and weekly on the default branch.

Supabase's security advisor reported a disabled leaked-password-protection warning.
The app currently offers OAuth (and optional passwordless email), not password
sign-up. No paid feature was enabled to clear that warning. Reassess the Auth
settings if password sign-in is introduced later.

The dependency scan covers the active hosted requirements, not the separately
preserved, undeployed `requirements-rag.txt`. It resolves the pinned dependency
graph; it is not an inventory of the currently running Render container or its OS
packages. The `node:24` / Python 3.13 base image tags still receive upstream patch
updates and should be rebuilt regularly.

## Repeat the checks

Use Python 3.13 for the hosted dependency snapshot, Node 24+, and the repository's
pnpm version. Install Gitleaks 8.30.1 from its official release with checksum
verification (the workflow includes the expected Linux checksum).

```sh
python -m pip install -r requirements-hosted.txt
pnpm install --frozen-lockfile
pnpm audit
python -m pip install pip-audit==2.9.0
python -m pip_audit -r requirements-hosted.txt
gitleaks git --redact --no-banner --ignore-gitleaks-allow --config=.gitleaks.toml --log-opts=--all
python scripts/test_secret_scanner.py /absolute/path/to/gitleaks
python -m unittest discover -s tests -v
pnpm test
pnpm build
pnpm exec playwright install chromium
node tests/security.browser.mjs
```

To refresh the hosted snapshot, resolve the declared requirements in a clean
Python 3.13 environment, update every pinned version, audit it, and run the full
application/benchmark checks before merging. Keep `requirements.txt` included in
the snapshot so its direct constraints are checked too. Never ignore advisories
or secret findings merely to make CI green.

## Limits

- This is an engineering review with regression tests, not an independent
  penetration test or a security certification. No load or exploit testing was
  performed against live users or the production database.
- CSV protection is for the exported file. Spreadsheet software can remove text
  escapes when a user saves/reimports a CSV; don't treat an edited CSV as a trusted
  program or repeatedly round-trip untrusted data. JSON preserves original text
  for programmatic exports. See [OWASP's CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection).
- In-memory rate limits reset on restart and are scoped to one server instance.
  They are not distributed DDoS protection. Free-hosting cold starts and provider
  capacity remain operational limits.
- Branch rules must stay active. After merge, verify CI, the actual deployed
  commit, and the [public deployment smoke checks](deployment.md) before calling
  the changes live. Existing backup and recovery drills still need operational
  ownership; this audit does not configure a backup secret or read one.

References: [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api),
[authoritative user verification](https://supabase.com/docs/reference/javascript/auth-getuser),
[Gitleaks](https://github.com/gitleaks/gitleaks), and
[pip-audit](https://github.com/pypa/pip-audit).
