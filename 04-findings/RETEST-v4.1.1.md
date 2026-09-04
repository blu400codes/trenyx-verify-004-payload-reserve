# Retest — payload-reserve v4.1.1 (fix verification)

**Date:** 2026-09-04. **Fixed release:** v4.1.1, tag `162e6aebcb7b1ac72aa7aefbebe0653e27075059`.
**Reported against:** b04d04b (2026-09-01 disclosure). **Toolchain:** Node 22.23.2 (nvm), pnpm 9.15.9,
in-memory MongoDB replica set (mongodb-memory-server) — identical to the 01-baseline environment.
**Method:** independent — our own reconstructed exploit, NOT the maintainer's regression test. The
maintainer's own test (`dev/standaloneAccess.int.spec.ts`) also covers the chain; we did not rely on it.

## F1 (HIGH, account takeover) — CONFIRMED FIXED
`04-findings/retest-411.int.spec.ts`, standalone default config `payloadReserve({...})`, 5/5 pass —
every step that SUCCEEDED on b04d04b is now DENIED:

| scenario | b04d04b | v4.1.1 |
|---|---|---|
| S1 B lists customer A in /customers | totalDocs ≥ 1 (A visible) | B sees only self; A not in list |
| S2 B reads A's reservation by id | returned the document | not found (scoped out) |
| S3 B updates A's reservation | notes rewritten | rejected; notes unchanged |
| S4 B deletes A's reservation | deleted | rejected (delete now staff-only) |
| S5 B sets A's password + logs in as A | login token returned | password update rejected; login as A with forged pw rejected |

Positive control (guards against a vacuous pass): S5 also asserts A's REAL password still logs in
(`token` truthy) — so the denials are access control, not a broken request. Run log:
`04-findings/retest-411-output.txt`.

Fix shape (read from v4.1.1 src, for the record): `makeStandaloneReservationAccess` scopes
read/update to `{ customer: { equals: req.user.id } }` and makes delete `privilegedOnly`;
`makeStandaloneCustomerAccess` scopes customers read/update to self and delete to staff; the
`notes` field carries its own staff-only read/update access; `enforceCustomerOwnership` is now wired
on update as well as create (Reservations.ts:302). userCollection mode is documented + boot-warned,
not code-changed (the plugin cannot tell staff from customers there without configured roles) —
which matches the disclosure's own note that this mode is the host's responsibility.

## F2 (MEDIUM, timezone) — CONFIRMED FIXED (pure check)
`04-findings/retest-f2f4-output.txt`. `isExceptionDate('2025-12-25', [{date:'2025-12-25'}],
'America/New_York')` now returns **true** (was false on b04d04b). This pure-function check is the
load-bearing proof. The paired dynamic slot assertion carries a schema-shape fallback that can skip
its body, so it is NOT counted as independent evidence — recorded honestly rather than overstated.

## F4 (LOW, fractional guestCount) — CONFIRMED FIXED
Same run: `guestCount: 1.5` is refused at collection create (was accepted); integer `2` still accepted.

## Verdict
All three reported findings independently confirmed fixed in v4.1.1. The exploit that was withheld
during the disclosure window is reconstructed in `retest-411.int.spec.ts` and now serves as the
regression proof. Maintainer cleared publication (email, Eslam, 2026-09-04).
