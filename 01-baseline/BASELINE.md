# Baseline — elghaied/payload-reserve @ b04d04b7355cae199209ebb4630ea5ab00ab2e02

Order of events (all UTC, machine-recorded): anchor Issue #1 created 2026-09-01T13:01:04Z →
clone started (UTC): 2026-09-01T13:02:22Z → baseline suite started 2026-09-01T13:03:58Z, finished 2026-09-01T13:04:59Z.

Environment reconstructed on macOS (host ships Node 16): Node v22.23.2 via nvm, pnpm 9.15.9 via
corepack (lockfile v9.0; the target's CI uses Node 22 + `pnpm install --frozen-lockfile`).
`pnpm install --frozen-lockfile` clean. The integration project boots a MongoDB replica set via
`mongodb-memory-server` (`dev/globalSetup.ts`); the components project runs under jsdom.

- `pnpm test:int` (Vitest, both projects, run exactly as CI does) — **58 files passed · 676 tests
  passed · 0 failed · 59.15 s.** Green suite confirmed.
- `pnpm test:e2e` (Playwright, `dev/e2e.spec.ts`) — **not run**: requires browser binaries and a
  running Next.js app; out of scope for this pass and recorded as such, not as a failure.
- Adapter under test = MongoDB replica set. Per the README, that is the adapter on which the
  concurrency story (bookingLock + retry) is fully supported — so the shipped suite CAN observe
  the serialization guarantees here; the Postgres/SQLite branches were not exercised.

Note: the target's own vitest.config.js comment cites "604 / 0" as a historical true figure; the
pinned commit reports 676. Counts are from this run's summary line, not typed.
LOGIN-AS-A-WITH-B-PASSWORD: true
