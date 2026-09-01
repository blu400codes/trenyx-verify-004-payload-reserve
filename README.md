# trenyx-verify-004 — independent verification of an AI-assisted booking plugin

**Target:** [elghaied/payload-reserve](https://github.com/elghaied/payload-reserve) at
`b04d04b7355cae199209ebb4630ea5ab00ab2e02` (2026-08-26). A Payload CMS 3.x reservation/booking plugin
(conflict detection, capacity, transactional booking lock, slot holds, status machine, business
timezone, guest bookings, access-controlled endpoints); 63% of commits `Co-Authored-By: Claude`.
Fourth public sample of the [Trenyx](https://trenyx.io) method; first run with the shop's
catalogue-driven planting harness. The maintainer did not commission it and owes nothing to it.

## How to verify us

| folder | what's in it | how you check it |
|---|---|---|
| `00-preregistration/` | the attack plan written BEFORE any implementation was read, its SHA-256, and the anchor | `shasum -a 256 -c ATTACK-PLAN.sha256`; then confirm [Issue #1](https://github.com/blu400codes/trenyx-verify-004-payload-reserve/issues/1)'s server `created_at` (2026-09-01T13:01:04Z) predates every later commit and the clone time in `01-baseline/` |
| `01-baseline/` | the target's own suite, run as shipped: counts, environment, order of events | re-run it |
| `02-independent-tests/` | 25 scenarios written blind to the target's tests + the refuter-requested follow-up probe, with raw output | copy into a clone at the pinned commit and run |
| `03-planted-defects/` | `plants.json` (one exact edit per pre-registered defect class) + the detection matrix | apply a plant, run their suite, compare with `matrix.md` |
| `04-findings/` | confirmed / potential / design concern / recommendation, each with a reproduction — **publishes after responsible disclosure** | run the reproduction |
| `05-receipt/` | SHA-256 of every artifact above, dated | hash the files yourself |

## Results (2026-09-01)

| measure | result |
|---|---|
| Pre-registration anchor | Issue #1 created 2026-09-01T13:01:04Z (server clock) → target cloned 13:02:22Z → baseline 13:03:58Z |
| Target's own suite at baseline | **676 passed · 0 failed** (58 files, 59 s; Node 22, pnpm 9, MongoDB memory replica set; Playwright e2e not run) |
| Planted semantic defects (pre-registered classes) | 17: 13 plantable · 4 native (found by our tests) |
| **Caught by the target's tests** | **11 / 13** — escaped: a booking lock taken for only the first of several claimed resources; the first idempotency-key replay accepted at the hook (the unique index still refuses it — see findings) |
| Independent scenarios (blind) | 25 — 17 pass · 8 fail (4 access-control failures withheld pending disclosure) |
| **Confirmed defects** | **2** (1 HIGH access-control, 1 MEDIUM timezone) + 2 LOW + 5 design concerns — being disclosed to the maintainer privately first; `04-findings/` publishes after a fix lands or ~14 days |

Read against the earlier samples (5/11, 7/11, 14/16): this suite tests its booking core seriously —
buffers on both sides, capacity in both modes, holds, the status machine, token hygiene, active
enforcement all held under adversarial input. The defects are at the edges the suite doesn't reach:
default collection access in the Quick Start configuration, and date-only inputs west of UTC.
Denominators are ours and published; these numbers describe *this* attack, not a universal score.

## Rules this engagement runs under

1. **Pre-registration:** the attack plan is hashed and anchored to a clock we don't control before the
   code is read — here GitHub's server-side `created_at` on Issue #1, with the plan as the repository's
   first commit. The plan file is never edited afterwards (additions go in `APPENDIX-n.md`).
2. **Blind tests:** ours are written without reading the target's `*.spec.ts` files.
3. **Disclosure before publication:** planted defects and the matrix publish as produced (they describe
   the tests, not exploitable behaviour). Any real defect goes to the maintainer first; the
   access-control item goes through a private channel; `04-findings/` publishes after they have had
   the chance to see it.
4. **Every judgment call gets an independent refuter** (two grades were lowered by ours) and a fresh
   buyer's check runs before publication. Harness mistakes of our own are recorded in
   `02-independent-tests/RESULTS.md`, not hidden.
5. **No guaranteed bug count; coverage is reported with its denominator.**

## Licensing
The target is MIT; our tests and plants (`02-`, `03-`) are MIT. Reports and documents (`00-`, `01-`,
`04-`, `05-`, this README) are CC-BY-4.0.
