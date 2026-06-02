# algo-dsl release notes

## 0.6.0 — Notifications as a first-class Studio object

- New top-level builder `mbd.notification(name)` — composes 1-N saved algos
  into a single webhook subscription. POSTs to `${deployService}/deploy/notifications`.
  - `.algos([algoIdA, algoIdB])`
  - `.webhook(url, { authBearer })`
  - `.budget({ daily, perType })`
  - `.cooldown({ hours, by })`
  - `.priorityFilter('P0,P1')`
  - `.save()`, `.update(id)`, `.activate()`, `.pause()`, `.preview()`, `.test()`, `.describe()`
- `StudioConfig` gains:
  - `deployService` URL (auto-derived from `commonUrl`; overridable via `servicesUrl`).
  - `mode: 'normal' | 'match'` — match mode short-circuits all builder `.execute()`
    calls into filter / target snapshots written to `captures`. The push worker
    in ds_algo_runner uses this to evaluate filter stages against a single
    Pub/Sub candidate without touching the network.
  - `captures` — `{ searches, hydrations, rankings, injectedCandidate }`.
- `Studio.injectCandidate(doc)` — seed a single doc into the candidates list
  for match-mode evaluation.
- `Search.getFilters()`, `Search.matchesCandidate(doc)` — SDK ergonomics for
  synchronous predicate evaluation.
- `Hydration.getTargets()` — snapshot of target → spec for the push worker.
- Standalone export `matchFilters(doc, { include, exclude })` from
  `algo-dsl/V1/notification/match.js`.

No breaking changes; match mode is opt-in via `StudioConfig`.
