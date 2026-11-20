# Runtime training Skills

This directory is the production source of truth for real-time training.
Every published release is immutable and contains stable filenames:
`SKILL.json`, `protocol.json`, `assessment_config.json`,
`adaptation_policy.json`, `step_templates.json`, and `knowledge/`.

`_registry.json` is consumed as a release index. Its `content_sha256` is the
raw SHA-256 of `protocol.json`; the service additionally computes a canonical
release hash across every structured contract for audit and reproducibility.
New content must be published under a new semantic version.
