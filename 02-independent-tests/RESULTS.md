# Independent tests — written blind to the target's own test files

`blind.int.spec.ts` boots its own Payload instance (standalone customers, guest bookings on, slot
holds on, business timezone America/New_York — the README's own example) on the run-wide memory
replica set, and asserts the invariants pre-registered in `00-preregistration/ATTACK-PLAN.md` §2.
Only `src/`, the README, and the `dev/` harness helpers were read before writing it; none of the
target's `*.spec.ts` files were.

**Result: 25 scenarios — 17 pass · 8 fail.** A failing scenario is a CANDIDATE finding; each was
handed to an independent refuter before grading (see `04-findings/`). Raw verbose output:
`run-output.txt`.

| # | invariant | scenario | result |
|---|---|---|---|
| 1 | I-AUTHZ · default (plain-install) collection access between customers | customer B cannot READ customer A's reservation through the collection API | **FAIL** |
| 2 | I-AUTHZ · default (plain-install) collection access between customers | customer B cannot UPDATE (reschedule/cancel) customer A's reservation | **FAIL** |
| 3 | I-AUTHZ · default (plain-install) collection access between customers | customer B cannot DELETE customer A's reservation | **FAIL** |
| 4 | I-AUTHZ · default (plain-install) collection access between customers | customer B cannot read other customers' PII through the customers collection | **FAIL** |
| 5 | I-STATUS · cancellation notice cannot be bypassed | cancelling inside the notice window is refused; outside it is allowed | pass |
| 6 | I-STATUS · cancellation notice cannot be bypassed | the OWNER deleting their own reservation inside the notice window is refused (delete must not bypass the policy) | **FAIL** |
| 7 | I-STATUS · cancellation notice cannot be bypassed | an illegal transition is refused and a terminal status is final | pass |
| 8 | I-STATUS · cancellation notice cannot be bypassed | a non-privileged caller cannot create a reservation already in a non-default status | pass |
| 9 | I-TIME · exception days resolve in the business timezone | pure: a YYYY-MM-DD exception (the README's documented form) blocks THAT day in America/New_York | **FAIL** |
| 10 | I-TIME · exception days resolve in the business timezone | dynamic: a schedule exception entered as 2025-12-25 removes slots on 2025-12-25, not on 2025-12-24 | **FAIL** |
| 11 | I-NOOVERLAP · overlap boundaries and buffers | touching intervals (end == start) do not conflict with zero buffers; a real overlap does | pass |
| 12 | I-NOOVERLAP · overlap boundaries and buffers | the EXISTING booking's after-buffer is enforced against a newcomer | pass |
| 13 | I-NOOVERLAP · overlap boundaries and buffers | the NEWCOMER's before-buffer is enforced against an existing booking | pass |
| 14 | I-NOOVERLAP · overlap boundaries and buffers | fixed-duration endTime cannot be tampered shorter to dodge a conflict | pass |
| 15 | I-CAPACITY · quantity and per-guest counting | per-reservation: quantity 2 admits two overlapping bookings and refuses the third | pass |
| 16 | I-CAPACITY · quantity and per-guest counting | per-guest: quantity 4 sums guest counts exactly | pass |
| 17 | I-CAPACITY · quantity and per-guest counting | guestCount must be a positive integer (0 and 1.5 are refused) | **FAIL** |
| 18 | I-IDEMPOTENT · keys and slot holds | a replayed idempotencyKey never creates a second reservation | pass |
| 19 | I-IDEMPOTENT · keys and slot holds | a hold blocks the slot for others, converts once with its token, and cannot convert twice | pass |
| 20 | I-IDEMPOTENT · keys and slot holds | a hold with guestCount 0 is a 400, not a 409 | pass |
| 21 | I-ACTIVE · inactive references are refused everywhere | an inactive resource referenced only via items[] is refused | pass |
| 22 | I-ACTIVE · inactive references are refused everywhere | rescheduling an existing booking onto an inactive resource is refused; cancelling it stays allowed | pass |
| 23 | I-GUEST-XOR · guest bookings and the cancellation token | exactly one of customer / guest; a guest needs name + (email | phone) | pass |
| 24 | I-GUEST-XOR · guest bookings and the cancellation token | the book response and a customer-level read never expose cancellationToken; a wrong token cannot cancel | pass |
| 25 | I-GUEST-XOR · guest bookings and the cancellation token | an anonymous caller cannot book as a named customer; an authenticated customer is forced onto their own id | pass |

## Passing = guards that hold (documented behaviour verified, not graded)
Touching intervals and both-sided buffers; per-reservation and per-guest capacity arithmetic;
fixed-duration end time cannot be tampered; idempotency-key replay refused; slot holds block,
convert once with their token, refuse a second conversion, and reject guestCount 0 with a 400;
inactive resources refused via items[] and on reschedule while cancel stays possible; guest/customer
exclusivity; the cancellation token never echoed and a wrong token refused; anonymous customer
spoofing refused and an authenticated customer forced onto their own id; illegal and post-terminal
status transitions refused; a non-privileged create cannot start in a non-default status.

## Harness notes (ours, not the target's)
- `createLocalReq` is **async** in payload 3.86 and attaches `payload`, `t`, `context` and
  `user` itself; the first two runs decorated a Promise and every "as customer" endpoint call was
  silently anonymous. Three failures (hold conversion, non-default status, one spoof check) were
  ours and disappeared once the request was awaited — recorded here so nobody re-learns it.
- Endpoint handlers THROW `APIError`s; Payload's HTTP layer maps them to their status. The harness
  mirrors that (`err.status ?? 500`), otherwise a 400 reads as a crash.
- The release endpoint is `/reserve/hold/release` (not `/reserve/release`).
