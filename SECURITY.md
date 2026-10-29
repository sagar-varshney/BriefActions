# Security

BriefActions stores private meeting transcripts and reviewed plans. Security fixes
target the current React → Node → Python application deployed from `main`.
The preserved `app/` FastAPI/RAG prototype is excluded from the production image.

## Report a vulnerability privately

Use GitHub's [Report a vulnerability](https://github.com/sagar-varshney/BriefActions/security/advisories/new)
form. Private vulnerability reporting is enabled for this repository. Include the
affected route or version, an explanation of the impact, and steps using invented
data. Never include a real transcript, password, access token, or database URL.
Avoid publishing exploit details in a public issue while a fix is being prepared.

If a credential was exposed, revoke or rotate it immediately; deleting it from a
file or rewriting Git history does not invalidate it.

## Verification

The [security review](docs/security-review.md) records the scope, verified
protections, regression tests, and remaining limits. Automated scanning catches
known patterns and advisories; it does not establish that the application has no
security vulnerabilities.
