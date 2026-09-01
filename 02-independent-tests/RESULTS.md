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
