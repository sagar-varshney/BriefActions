# Contributing to BriefActions

Bug reports, clearer wording, accessibility improvements and focused fixes are
welcome. BriefActions turns conversations into proposed tasks that people review
before confirming a plan.

## Start locally

Follow [Run locally](README.md#run-locally) for the supported Node.js, pnpm and
Python versions and installation commands. Local development uses SQLite and
needs no hosted account, API key or paid service.

The current application lives in `web/`, `server/` and the root Python modules.
The separate `app/` directory contains the preserved FastAPI/RAG prototype;
check the [development guide](docs/development.md) before choosing where to edit.

## Report a reproducible problem

Include the page or operation, steps to reproduce, expected and actual behavior,
and relevant browser/device information. For an extraction problem, provide a
short invented transcript, its meeting date, and the task, owner or deadline that
was missed or misread. The meeting date matters for words such as “tomorrow.”

Use invented examples in issues, screenshots and tests. Report vulnerabilities
through the private channel in [SECURITY.md](SECURITY.md).

## Make a focused change

Create a branch from current `main` and keep each pull request centered on one
problem. Preserve the original transcript and exact supporting passages. Missing
or uncertain metadata should remain Unknown; creating a plan or applying
follow-up changes still requires explicit confirmation.

For extraction fixes, add a regression that fails before the fix and passes
after it. Keep relevant negative and ambiguity cases too. The
[expanded regression contracts](tests/fixtures/README.md) show examples;
[evaluation guidance](evaluation/README.md) explains annotation and scoring.
Do not lower quality floors or change expected labels just to make a failing
check pass. Changes to datasets, scoring or baselines need an explicit explanation.

## Verify the change

With the local environment activated, run the checks appropriate to your edit:

```bash
python -m unittest discover -s tests -v
pnpm test
pnpm build
```

For interface changes, install the browser once and run the browser suites:

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

Check keyboard behavior, mobile layouts and both themes when changing the UI.
For extraction changes, run all three [development quality gates](docs/development.md#verification).
The development guide also covers disposable Postgres, backup and container checks.
Use an isolated test database for those workflows, not the public app's database.

## Open a pull request

Target `main` and explain the problem, the resulting behavior, and which checks
you ran. Include relevant limitations or screenshots for visible changes. Keep
unrelated cleanup separate so the fix is easy to review.

Required CI checks must pass before merging. CI verifies security, Python/API
behavior, extraction quality, browser accessibility, Postgres isolation,
backup/restore and the production container. See the
[CI workflow](.github/workflows/ci.yml) for the exact checks. A successful merge
and a verified production deployment are separate steps; the
[deployment guide](docs/deployment.md) describes the release workflow.
