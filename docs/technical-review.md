# Technical review and implemented improvements

## Scope and baseline

Reviewed every application file at baseline commit `07da71d`: the single-page HTML/CSS/JavaScript application, manifest, service worker, and two icons. No project README, package manager configuration, CI, or existing test suite was present. The baseline Chromium smoke check passed workout creation, localStorage persistence, worker control, asset serving and basic offline reload. More targeted audit probes reproduced the defects below.

The application is a local-only static PWA. Views share one version-1 state object; localStorage is the durable store, JSON files provide portability, and canvas charts visualize session/measurement history. There are no network APIs, authentication flows, credentials, production dependencies, or compilation requirements. The manifest and small icons did not warrant replacement. This pass preserves the visual design, features, static hosting, and storage key/schema.

## Priorities and outcomes

These are confirmed defects, ranked by impact and implementation risk; no general rewrite was needed.

| Priority | Confirmed problem | Implemented result | Regression risk / complexity |
| --- | --- | --- | --- |
| 1 | Imported IDs entered HTML attributes without escaping | Escape every workout ID used in markup; imported values remain inert | Low / small |
| 1 | Full restore discarded active weight/reps and starting defaults | Preserve/derive resumable fields and retain unknown metadata | Medium / bounded validation |
| 1 | Malformed records, non-text names, non-finite numbers and invalid dates broke rendering | Shared validated, atomic category/full imports; require complete full backups | Medium / compatibility tests |
| 1 | Failed saves continued as successes; corrupt saved data could later be overwritten | Return success/failure, roll back memory, protect original bytes, support recovery export; retry editors resolve current records | Medium / storage fault tests |
| 1 | Worker activation deleted unrelated caches; HTTP errors poisoned the offline shell | Scope cache ownership; cache only complete successful asset responses; track cache writes with worker lifetime | Medium / worker lifecycle tests |
| 2 | Offline launches with query strings missed the cache; hanging network blocked usable content | Canonicalize shell URLs and bound cached fallback to three seconds | Low / worker and browser tests |
| 2 | Names such as `constructor` and `__proto__` crashed grouping/summary/form code | Use dictionaries without inherited properties | Low / browser tests |
| 2 | Editing a workout erased exercise notes; deleting the final finished set retained deleted defaults | Preserve notes; restore original starting defaults when no sets remain | Low / workflow tests |
| 2 | Calendar dates appeared one day early west of UTC | Interpret date-only measurements as local calendar dates | Low / time-zone browser test |
| 2 | Workout start was not keyboard-accessible; modals lacked focus handling | Native start buttons, dialog semantics, Tab trap, Escape, focus restoration, associated labels | Medium / keyboard browser tests |
| 2 | Session rotation left old slide dimensions; inactive slides stayed focusable | Observe viewport sizing, preserve slide selection, mark inactive slides inert, dispose observers/listeners | Medium / rotation and keyboard tests |
| 3 | Repeated history sorting/scanning during rendering and exercise-name typing | Sort history once per session render; compute name suggestions once per create/edit visit | Low / behavior coverage |

Additional accessibility changes allow browser zoom, provide visible focus, announce toast messages, honor reduced motion, and keep modals scrollable in landscape. Session actions restore keyboard focus after rerendering. Input validation rejects invalid/negative new values and fractional reps, including inline edits; failed writes reset inline controls to the durable values.

Import/export handlers share category validation and JSON-download helpers rather than copying replacement logic. Test dependencies are development-only and do not load in the PWA.

## Verification

Current-instance validation on Linux with Node.js 24.19.0, Python 3.12.14, Playwright 1.62.1 and system Chromium:

- Baseline functional smoke check: passed before edits.
- Frozen dependency installation with `npm ci`: passed (cloud npm cache redirected to `/tmp`).
- `npm test`: 38 tests passed, 0 failed, 0 skipped.
  - 7 data unit tests: old/current backups, active-session controls, invalid shapes/values/dates, atomic replacement, metadata retention, quota rollback and raw-data protection.
  - 11 worker unit tests: atomic installation/failure, scoped cache cleanup, network freshness, error/redirect/partial protection, query fallback, timed fallback with late refresh, request limits and cache failures.
  - 16 application browser tests: create/log/edit/delete/finish/reopen, defaults, persistent state, notes, full restore, injection resistance, special names, time-zone dates, quota/recovery/retry handling, exports, repeated keyboard actions, real offline operation and an installed v4→v5 worker upgrade.
  - 4 UI browser tests: native keyboard start, offscreen controls, rotation, modal keyboard/focus behavior, labels and zoom.
- `git diff --check`: passed.
- Production build: not applicable; production remains static files with no bundler or runtime packages.

The added GitHub Actions workflow has not been run remotely in this task. Browser checks used Chromium; Safari/iOS installation, screen-reader behavior and other browser engines still need device testing. No deployment, merge, or live-infrastructure change was made.

## Performance evidence and limits

The worker's active cache is bounded to four canonical URLs instead of caching arbitrary GETs and query variants. The unit test checks a simulated stalled network returns the cached shell after the configured 3,000 ms deadline while a later response refreshes it. This is a latency bound, not a measured real-network speedup.

For a session with E exercises, history sorting decreases from E sorts per render to one. Suggestions previously scanned/sorted history on every nonempty keystroke; they now reuse one name list for the create/edit visit. These remove repeated work without changing ranking or suggestions. No percentage speedup, startup improvement or bundle-size reduction is claimed; runtime source grew to add safeguards. There was no evidence supporting a framework, bundler, asset rewrite or storage migration.

## Remaining opportunities and assessment

The highest-value follow-up is concurrent-tab conflict protection: whole-state localStorage writes still use last-writer-wins behavior. A storage-event/version conflict design should preserve unsaved work and be tested before adding synchronization. Also consider duplicate-ID import diagnostics; preserving existing IDs avoids destructive rewriting, but duplicates can make record targeting ambiguous.

For large histories, measure the cost of whole-state synchronous localStorage writes (especially notes) and chart rendering before considering batched writes, IndexedDB, chart downsampling, or module extraction. Such changes affect durability and should have realistic volume benchmarks. Charts still lack a full accessible data-table alternative, and the segmented progression selector could gain richer selected-state semantics. Test iOS/Safari offline updates, installation, and assistive technology on real devices.

The critical audited faults are fixed and covered by automated regressions. The app remains intentionally small and deployable as static files. Its principal unresolved reliability limitation is concurrent editing across tabs; its main verification gap is non-Chromium device coverage.
