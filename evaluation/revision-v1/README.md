# Revision and cancellation corpus v1

24 manually authored synthetic transcripts: 12 development, 12 held out. Meeting dates span 2026–2028, including month/year boundaries and leap days.
Labels are authored by Codex, not independently reviewed. No permitted real transcripts were available. This is a scenario validation corpus; related linguistic patterns occur across splits.

Inputs and gold annotations were written before running the benchmark. Only development examples may inform subsequent extraction changes. The test split was evaluated once for this update; it must not be used for further tuning. Create a new version or freeze a new human-reviewed annotation snapshot for later validation.

Each final active action has task, owner, exact deadline or Unknown, and original/revision supporting passages. Canceled commitments have no final gold item; the extractor separately retains cancellation evidence in the conversation audit. Ambiguous or non-immediate references leave the existing task unchanged for manual review.

The content hashes in manifest.json protect both splits. build_revision_corpus.py is a reproducible authoring script and refuses to overwrite an existing version. CI gates only development extraction, validates both file hashes, and does not rerun held-out predictions or live models.

The React Annotation reviewer collects separate human review submissions and recorded resolutions, then exports source-group splits with immutable assignments. Reviewer independence and identity are self-attested; adding two fake reviewer names does not create independently reviewed data.
