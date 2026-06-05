# algo-dsl release notes

## 0.7.0 — Algo triggers (subscribe vs poll)

- New `Search.trigger(spec)` builder method that declares how the push
  worker should discover candidates for this algo:
  - `{ mode: 'subscribe', topic?: 'notification-candidates' }` — current
    behavior, default for every existing algo. PubSub event-driven.
  - `{ mode: 'poll', interval_seconds, cursor_field, dedupe_key,
    initial_lookback_seconds? }` — new. Worker queries the algo's ES
    index on the given interval. Customer-defined signals against any
    ES index alpha doesn't publish to.
- `Search.getTrigger()` returns the captured spec (or null).
- `StudioCaptures` gains a `triggers: AlgoTrigger[]` array populated in
  match mode.
- `AlgoTrigger` type exported from `index.d.ts`.

Validation at the SDK level mirrors ds_deploy's server-side check —
poll requires interval >= 10, cursor_field, dedupe_key. Misconfigured
specs throw at call time.

No breaking changes. Algos without `.trigger(...)` default to subscribe.

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
