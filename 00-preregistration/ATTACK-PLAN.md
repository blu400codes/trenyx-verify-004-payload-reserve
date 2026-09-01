# Pre-registered attack plan — payload-reserve (verify-004)

**This document is written BLIND: from the README and public repository metadata only, before
reading a single line of implementation or tests.** Its SHA-256 is anchored externally before any
source is read — as the FIRST commit of this repository and as Issue #1 on it (GitHub's own
server-side `created_at` is the clock; git commit times are author-settable and do not count).
Once hashed and anchored, this file is FROZEN — additions go in `APPENDIX-n.md`, never here.

- **Target:** `elghaied/payload-reserve` — a reservation/booking plugin for Payload CMS 3.x
  (services, resources, schedules, reservations, customers; public REST API; admin UI).
- **Commit pinned for audit:** `b04d04b7355cae199209ebb4630ea5ab00ab2e02` (committer date
  2026-08-26T23:43:23Z, the default-branch HEAD at plan time). MIT. TypeScript, pnpm, Vitest +
  Playwright per the repository file listing. npm-published; four live demos advertised.
- **Domain:** scheduling / booking / inventory (fourth domain after trading, agent-authorization,
  payments). Catalogue read first (`verification/catalogue/`, skeleton rendered for `workflow`).
  Novelty quota: ≥3 faults not yet in `faults.json` (listed in §5).
- **Disclosure channel:** no `SECURITY.md` at the root. Anything with an access-control or
  double-booking consequence goes PRIVATE-first — GitHub private vulnerability reporting if
  enabled, else direct maintainer contact requesting a private channel — before any public issue.
- **Engagement terms:** free, unsolicited public sample of the method; the maintainer did not
  commission it and owes it nothing. Timebox: one working day of audit.

## 1. What the system claims to be (README only)
A plugin that adds appointment scheduling to Payload with: server-side **double-booking
prevention** ("enforces both bookings' buffer times and checks each resource only for its own item
window; respects capacity modes"); **capacity** (`quantity > 1`, `capacityMode` per-reservation |
per-guest); **multi-resource bookings** via `items[]`, with the top-level `resource` also
conflict-checked; a **transactional `bookingLock`** that serializes simultaneous bookers, with
retry recovering lost capacity on MongoDB and surviving conflicts mapped to HTTP 409; **slot
holds** ("convert to a real booking or release, both idempotent-safe"); an optional
**`idempotencyKey`** that "prevents duplicate submissions"; a **configurable status machine**
(transitions, blocking states, terminal states, `confirmStatus`/`cancelStatus`); a **cancellation
policy** (minimum notice); a plugin-level IANA **business timezone** governing schedule times, day
boundaries and exception days (with inclusive `endDate` ranges); **auto `endTime`** = `startTime +
service.duration` for `fixed`/`full-day`, editable for `flexible`; **active enforcement**
(inactive service/resource — including one referenced by `items[]` — blocks new bookings and
rescheduling, but confirm/cancel stay allowed); a **delete guard**; **guest bookings** (exactly
one of `customer` / `guest`; a `cancellationToken` NOT returned by the book endpoint, delivered via
hook, accepted unauthenticated by `/api/reserve/cancel`); **access control** (four endpoints gate
via one access-checked call; `/api/reserve/book` stays privileged with a tenant-membership probe as
its gate; a non-privileged caller is forced onto their own customer id; an anonymous caller may not
name a customer); **resourceOwnerMode** scoping; **external busy** folded into availability with
documented **fail-open** on resolver error; seven hooks that fire **inside** the transaction
(documented, not fixable). Documented adapter limits: non-replica-set MongoDB and SQLite without
`transactionOptions` give NO concurrency protection (warned at boot); SQLite cannot recover
capacity via retry and returns 500 not 409 under contention.

## 2. Invariants I will attack (their words, plus the semantic ones behind them)
- **I-NOOVERLAP.** No two reservations in *blocking* statuses on the same resource overlap once
  each one's buffer is applied on both sides. The boundary cases are the target: touching
  intervals (`a.end == b.start`), buffer applied on one side only, and `items[]` windows checked
  against the wrong window.
- **I-CAPACITY.** Concurrent blocking reservations on a resource never exceed `quantity`, counted
  per `capacityMode` (per-guest sums guest counts). Off-by-one at exactly `quantity`; holds counted
  or not; per-guest with a missing/zero guest count.
- **I-IDEMPOTENT.** One `idempotencyKey` → one reservation, regardless of retries; hold
  convert/release repeated → same outcome, one reservation, no extra capacity consumed. What is
  the key's scope (global? per customer? per resource?) — a scope wider than the caller can
  control becomes a denial vector; narrower than claimed becomes a duplicate.
- **I-STATUS.** Only configured transitions succeed; terminal states are final; the server (not
  the UI) is the authority, including via the collection's own REST `PATCH` and admin edits, not
  only the plugin endpoints. Cancellation minimum notice measured against the reservation's start
  in the business timezone, at the boundary.
- **I-TIME.** `fixed` end = start + duration (never editable into a shorter/longer window that
  dodges conflict); day boundaries and exception `date..endDate` are inclusive at both ends in
  the business timezone, including DST-transition days and `full-day` services; slot generation
  never emits a slot that crosses into an exception day or off-schedule time.
- **I-ACTIVE.** `active: false` on a service/resource — including any referenced through
  `items[]` — blocks create *and* reschedule/re-point, and is excluded from availability; confirm
  and cancel remain allowed.
- **I-AUTHZ.** An anonymous caller cannot book as a named customer; a non-privileged caller is
  forced onto their own customer id; owners see only their own resources/schedules/reservations;
  unauthenticated cancel requires a valid token for that exact reservation; the token never
  appears in the book response, list/read responses, or admin-visible fields for non-privileged
  readers; a forged tenant cookie cannot resolve another tenant's zone or write into it.
- **I-GUEST-XOR.** Exactly one of `customer` / `guest`; `guest` needs name + (email | phone).
- **I-LOCK.** The `bookingLock` is acquired for EVERY claimed resource (top-level + each
  `items[]` entry) before the conflict check runs, in a stable order; a lock acquired for only some
  resources is a TOCTOU window. A surviving conflict is a 409 (Mongo/Postgres), never a silent
  success.
- **I-DELETE-GUARD.** Deleting a referenced service/resource/schedule fails with a message; no
  dangling reference.

Documented scope limits — tested as GUARDS that must hold as documented, NOT graded as defects
(the ha-rbac discipline): external-busy fail-open; hooks fire pre-commit; SQLite retry/500
limitation; non-transactional adapters unprotected (warned); `items[]` guest gate evaluated on the
top-level service only; consumer `access.reservations.create` not applied to the privileged book
write. Each is checked for one thing only: does the *documented* behaviour actually hold, and
does its failure mode stay confined to what the README says (e.g. does a fail-open resolver ALSO
fail open the lock/conflict path — that would exceed the documented scope).

## 3. External dependencies (assumptions to probe)
Payload CMS 3.x (`^3.86`) collections/hooks/access pipeline, transactions per adapter
(`@payloadcms/db-mongodb` replica set, `db-postgres`, `db-sqlite` + `transactionOptions`); the
dev harness's adapter choice (SQLITE=1 branch mentioned) determines which concurrency guarantees
the *shipped tests* can even observe; date/timezone library behaviour on DST days; `multiTenant`
plugin ordering; Playwright e2e (browser-driven admin UI) — likely NOT runnable here.

## 4. Attack paths (pre-registered — the classes I will test)
- **A · Overlap boundaries (I-NOOVERLAP).** Touching intervals, one-sided buffer, buffer taken
  from only one of the two bookings, `items[]` window vs top-level window, cross-day windows.
- **B · Capacity counting (I-CAPACITY).** `quantity` off-by-one, per-guest arithmetic, holds
  vs capacity, cancelled/terminal bookings still counted, non-blocking statuses counted.
- **C · Idempotency & holds (I-IDEMPOTENT).** Replayed book with same key (same/different
  payload); hold convert twice / release twice / convert after expiry; key collisions across
  customers.
- **D · Status machine authority (I-STATUS).** Illegal transition via plugin endpoint vs via
  `PATCH /api/reservations/:id` vs admin; re-opening a terminal state; cancel inside the notice
  window at the exact boundary; `confirmStatus`/`cancelStatus` misconfiguration accepted.
- **E · Time & timezone (I-TIME).** Fixed-duration `endTime` tampering; exception `endDate`
  inclusive; DST-day day-boundary; `full-day` on a non-UTC zone; slot step edge at schedule end.
- **F · Active enforcement (I-ACTIVE).** Reschedule onto an inactive resource; `items[]`
  containing an inactive resource; confirm/cancel of an existing booking on an inactive resource.
- **G · Authorization (I-AUTHZ).** Anonymous `customer` spoof; non-privileged caller naming
  another customer; owner scoping leaks (resource-availability for another owner's resource);
  guest token: wrong reservation, absent, leaked in any response; tenant cookie forgery on
  effective-timezone / book.
- **H · Lock coverage & ordering (I-LOCK).** Static read: is every claimed resource locked before
  the conflict query, and is the lock write inside the same transaction as the reservation write?
  Is the 409 mapping reachable for every conflict class? (Dynamic contention tests only if the
  dev adapter supports transactions; otherwise recorded as untestable here, not as a finding.)
- **I · Boundary / malformed.** Negative or zero duration, `startTime` in the past, end before
  start on `flexible`, unknown status in config, guest with neither email nor phone, both
  `customer` and `guest`.

## 5. Planted-defect classes (for the existing-test challenge vs their suite)
Plant semantic defects one at a time with `verification/audit` and record which of THEIR tests
catch each. Reused catalogue classes: **F-LIMIT-OFFBYONE** (capacity `>=` → `>`),
**F-EXCEPTION-SWALLOWED** (conflict error → success-shaped return), **F-CONFIG-PARTIAL-ACCEPT**
(invalid transition/config entry skipped), **F-ATTRIBUTION-FROM-INPUT** (customer id honoured from
the caller), **F-EXIT-IGNORED** analogue (cancel-policy check bypassed). **New faults (novelty
quota, ≥3, added to `faults.json` after):**
- **F-OVERLAP-TOUCHING** — touching intervals (`end == start`) or a one-sided buffer treated as
  non-conflicting.
- **F-LOCK-PARTIAL** — `bookingLock` acquired for only some of the claimed resources (or after
  the conflict check) — a TOCTOU window the concurrency story silently loses.
- **F-IDEMPOTENCY-KEY-IGNORED** — the key stored but never consulted, or scoped so a replay
  creates a second reservation.
- **F-TZ-RANGE-EXCLUSIVE** — exception `endDate` treated exclusive (the last leave day becomes
  bookable), or day boundary computed in server time instead of the business zone.
- **F-HOLD-CONVERT-DOUBLE** — converting a hold twice creates two reservations / consumes
  capacity twice.
- **F-ACTIVE-ITEMS-UNCHECKED** — inactive resource referenced only via `items[]` accepted.
- **F-TOKEN-LEAK** — `cancellationToken` returned in the book/read response.
Final plants are chosen after reading, from these classes; a class that turns out NATIVE (already
present) becomes a finding, and a class that cannot be planted is recorded N/A with the reason.

## 6. Method (after the anchor exists)
Baseline (install via nvm Node 22 + corepack pnpm 9 — the verify-003 recipe; run the Vitest suite
as shipped, record counts + environment; Playwright e2e recorded as not run if it needs browsers
or a live app) → independent tests written blind to their `test/`/`*.spec` files, asserting §2 on
adversarial inputs → planted-defect matrix (plant → their suite → revert → caught/escaped) →
findings. Static-only where dynamic would execute anything unsafe (this is a plugin with a dev
harness; running its test suite is safe; never point it at a real database).

## 7. Findings taxonomy & discipline
Each finding tagged **confirmed defect / potential defect / design concern / recommendation**;
confirmed defects graded critical/high/medium/low with a reproduction. "Confirmed" only with a
repro. Documented scope limits are never graded as defects. Every judgment call gets an
independent refuter; a fresh buyer's-check before any publication. Disclosure private-first.
Denominators are ours and published — the numbers describe this attack, not a universal score.
