# External anchor — verify-004 payload-reserve pre-registration

The attack plan (`ATTACK-PLAN.md`) was hashed and anchored BEFORE any implementation was read.
Two anchors; the second is the one that counts:

- **SHA-256 of ATTACK-PLAN.md:** `f172b405a9d7e62f43e4d6c26d75809a0a3b413b6638515e66f03db840699fef`
- **First commit of this repository:** `3567309d8c6fb0023506409fea11d8a5dc9fb0f0` (plan + hash only) — proves ordering
  *inside* the repo; commit times are author-settable, so it is the weaker anchor.
- **Public anchor (governs):** https://github.com/blu400codes/trenyx-verify-004-payload-reserve/issues/1 —
  `created_at` = `2026-09-01T13:01:04Z` (GitHub server clock, taken from the API, not typed).
- **Pinned commit audited:** `b04d04b7355cae199209ebb4630ea5ab00ab2e02`

Verify later: `shasum -a 256 -c ATTACK-PLAN.sha256` must pass, the issue's `created_at` must
predate the first baseline/audit commit, and the target clone happened after it (recorded in
`01-baseline/`).
