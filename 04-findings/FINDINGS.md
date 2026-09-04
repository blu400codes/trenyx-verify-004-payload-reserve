# Findings — trenyx-verify-004 · elghaied/payload-reserve

**Target:** elghaied/payload-reserve @ b04d04b (2026-08-26). **Reported privately:** 2026-09-01.
**Fixed:** v4.1.1 (tag 162e6ae), 2026-09-04. **Status: RESOLVED** — all three reported findings
confirmed fixed by independent retest (see `RETEST-v4.1.1.md`); the maintainer reproduced them,
added a permanent regression test, and cleared this write-up.

Every "confirmed" item has a reproduction in `02-independent-tests/`; grades are booking/PII impact,
recorded AFTER independent refutation. The F1 takeover exploit was withheld during the disclosure
window and is published here as the reconstructed regression test (`04-findings/retest-411.int.spec.ts`),
which now runs GREEN against v4.1.1 — i.e. the takeover is denied at every step.

## Confirmed defects (all fixed in v4.1.1)

**F1 — HIGH — Default install: any logged-in customer could read, modify and delete every other
customer's reservation, list every customer's details, and take over any customer account.**
In the default standalone install the plugin creates the customer auth collection itself but left
collection access at Payload's default `Boolean(user)`, so any customer login reached every other
customer's records through the generic REST API. Because `update` covers the `password` field on an
auth collection, a customer could set another customer's password and log in as them — full account
takeover. Where: `Reservations.ts` access default, `Customers.ts` (auth with only `admin:()=>false`),
`enforceCustomerOwnership` guarded CREATE only.
*Fixed:* v4.1.1 scopes read/update to the owner, makes delete staff-only, runs the ownership hook on
update, and puts customer notes behind a staff-only field rule. Retest: 5/5 takeover steps denied.

**F2 — MEDIUM — Date-only exception / manual-slot dates resolved to the previous calendar day west
of UTC** (the README's own America/New_York example). `new Date('2025-12-25')` is 00:00Z, which is
Dec 24 in New York, so a day marked closed stayed open. The admin picker was safe; API/seed-written
bare dates hit it. *Fixed:* v4.1.1 resolves date-only fields by their UTC calendar date. Retest:
Dec 25 now closes on the 25th.

**F3 — LOW — Deleting a reservation skipped the cancellation-notice policy and fired no hooks.**
Subsumed by F1 (only staff can delete now). *Fixed:* delete is staff-only in standalone mode.

**F4 — LOW — Non-integer guestCount accepted on the collection** (1.5), while `/reserve/hold`
correctly rejected it. *Fixed:* v4.1.1 rejects fractional guestCount at the collection.

## Design concerns (non-exploitable; documentation/behaviour)
- **DC1** `validateCancellation` bound admins too (no privilege bypass) — likely unintended.
- **DC2** Docs contradicted behaviour: `collections.md` said notes were admin-only (they weren't),
  `configuration.md` opened self-registration unnarrowed. *Both doc passages corrected in v4.1.1.*
- **DC3** `dev/seed.ts` wrote exception dates from local midnight (server-timezone dependent) — the
  same root cause as F2.

## Guards verified as sound (not graded)
Both-sided buffers, touching intervals, per-reservation and per-guest capacity, tamper-proof fixed
endTime, idempotency replay refused, hold block/convert-once/refuse-twice, active enforcement and
reschedule, guest/customer exclusivity, cancellationToken never echoed, anonymous spoof refused,
status machine incl. terminal states.

## Retracted / harness-caused (kept for honesty)
Three early failures were OUR harness (`createLocalReq` is async; a Promise was passed as the
request, so "as customer" calls ran anonymous): hold conversion, non-default status on create, and
the customer-spoof check all PASS with a real request. Recorded in `02-independent-tests/RESULTS.md`.

## Resolution
All three reported findings independently confirmed fixed in v4.1.1 (`RETEST-v4.1.1.md`,
`retest-411-output.txt`, `retest-f2f4-output.txt`). The withheld F1 exploit is published as the
reconstructed regression test. Credit to the maintainer (Eslam) for a same-cycle fix, an added
regression test, and clearing the write-up.
