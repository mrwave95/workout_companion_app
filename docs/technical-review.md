# Engineering review

Comparison base: original static app at `07da71d`. The optimization history and earlier reports remain in Git; this document consolidates their current findings and release conditions.

## Architecture and cost

`index.html` still contains all UI, styles, state, validation and canvas charts. `sw.js` handles offline assets. The manifest and two small icons are unchanged. There are no runtime packages, external APIs, modules, framework, bundler, database migration or added network requests.

| Measure | Original | Before size review | After simplification |
| --- | ---: | ---: | ---: |
| HTML + worker source lines | 1,627 | 1,979 | 1,963 |
| HTML + worker bytes | 73,466 | 93,099 | 92,451 |
| HTML + worker gzip bytes | 18,368 | 24,246 | 24,040 |
| All five production assets, bytes | 77,509 | 97,142 | 96,494 |

Gzip figures compress each source file separately with a fixed timestamp; actual hosting compression may differ. The app grew to protect data and offline operation. No overall startup speedup or bundle-size reduction is claimed. Repeated history sorting was reduced from once per exercise to once per session render, and suggestions reuse one name list per create/edit visit.

## Safeguards retained

| Area | Verified problem addressed and resulting behavior |
| --- | --- |
| Import security and validation | Escape imported IDs in markup; validate records, dates, finite numbers and versions before confirmation. Full backups require all three collections; category imports replace only their category. |
| Persistence and recovery | Preserve active-session controls, notes and unknown metadata. Failed writes roll memory back, reset controls and cannot report success; retries resolve current records. Corrupt saved bytes remain exportable and protected from accidental replacement. |
| Multiple tabs | An exclusive browser Web Lock permits one editor per shared storage context. Waiting tabs can export snapshots, then load current data on ownership transfer. Raw-byte checks and storage events freeze stale editors; full restores cannot bypass ownership checks. |
| Draft protection | Unchanged-snapshot lifecycle restores retain forms. Conflict exports attach `rackedRecoveryDraft` metadata, with a collision-safe name, for manual recovery of unsaved fields. Importing a backup does not automatically apply those drafts. |
| Offline assets | Cache only four complete successful app responses under a scope-owned name. Track writes through worker lifetime; preserve other apps' caches. Root/index launches and query variants share one shell. Network-first uses cached fallback on errors/offline or after a three-second stall, with late refresh allowed. |
| Usability | Keyboard workout activation, modal focus/escape/trapping, associated labels, zoom, inactive-slide isolation and responsive carousel sizing preserve existing design and workflows. Date-only measurements use local calendar dates. Clipboard failure reports manual copying; numeric edits cannot persist overflow as null. |

The raw observed storage bytes and the normalized rollback snapshot serve different purposes; merging them would weaken conflict detection or recovery. Explicit lock lifecycle handling prevents stale writes after navigation or suspension. Legacy cache names are deliberately retained because their ownership cannot be proven. These are safety costs, not speculative abstractions.

## Simplification pass

- Replaced five browser-server/launch/cleanup implementations with one test-only helper. Scenario fixtures and assertions remain local; no page-object framework was added.
- Kept all 55 test cases: data unit and browser tests exercise different boundaries; the legacy worker fixture is required to verify upgrades; compatibility scenarios run in a second engine in CI.
- Removed unused carousel APIs and the controller for listeners on disposable DOM nodes. ResizeObserver disconnection remains necessary and is retained.
- Replaced manual FileReader/Promise plumbing with native `file.text()`, supported within the documented browser baseline. Removed a never-used array fallback parameter.
- Removed duplicate lock-request state: the existing controller already tracks the pending/held request lifetime. One entry guard controls reacquisition.
- Consolidated overlapping technical/release reports here, shortened the README, and made CI share installation/setup in one job. The generated dependency lockfile remains intact.

## Verification and release limits

The original app had no tests or build. All **55 regression tests pass** after simplification, with no failures/skips; JavaScript/manifest parsing and whitespace checks pass. `npm ls --omit=dev --all` reports an empty production dependency tree. Browser contexts capture uncaught errors, including pages created during multi-tab tests. Seed fixtures skip opaque about:blank origins; import tests wait for asynchronous completion before reloading.

Local browser evidence is **Linux Chromium** through Playwright 1.62.1. Multi-tab checks use independent pages, real Web Locks and localStorage; pagehide/pageshow coverage uses synthetic lifecycle events, not proof of real-device BFCache behavior. CI also runs 14 Linux WebKit checks; these are not iPhone/iPad tests.

Local WebKit installation remains blocked by HTTP 403 from the environment proxy for `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`. Static analysis supports Safari/iOS 15.5+ (`inert` and Web Locks baseline); the main viewport and modal retain vh/dvh fallbacks, safe-area padding and install metadata.

The earlier CI run passed the main 55 tests and 13/14 WebKit checks, failing offline navigation with an internal engine error. This matches the confirmed Playwright offline-emulation defect [#42775](https://github.com/microsoft/playwright/issues/42775), fixed upstream in [#42894](https://github.com/microsoft/playwright/pull/42894). The compatibility test now disconnects the origin server, requires a successful response from the installed service worker, and checks that notes and sets survive. It does not catch/ignore errors or change application behavior. Chromium's existing `setOffline(true)` checks remain; a server outage is not a claim of real-device offline validation. Current second-engine results are recorded by CI.

**Release assessment:** tested Chromium workflows are suitable for release review; broad Safari/iOS sign-off remains conditional on real-device checks. Before rollout, refresh/close older tabs: old JavaScript cannot be retroactively forced to honor the lock. Unsupported locking fails closed with export available. A background editing tab retains ownership until it closes/navigates; there is no unsafe forced takeover or automatic merge.

On supported iPhone/iPad Safari and a Home Screen installation, verify installation/icons/scope, saved sets/notes after restart, multiple-tab ownership transfer, background/back-navigation behavior, update then offline relaunch, JSON import/export through Files, cancel/recovery/quota paths, virtual-keyboard/rotation/zoom/VoiceOver, and data expectations between separate storage contexts. Neither localStorage nor CacheStorage is a permanent backup.

Remaining opportunities are duplicate-ID diagnostics, accessible chart tables and measured large-history storage/rendering work. They do not justify a framework, storage migration or speculative optimization now.

## GitHub Pages

Keep the existing **Deploy from a branch → main → /(root)** configuration and site URL. The proposed publishing workflow was unnecessary and has been removed; no replacement or settings change is needed. Testing CI remains independent of publishing. Changes to `main` publish the site, so merging or pushing directly to `main` requires explicit approval. Development files remain in the repository and are not loaded by the app.

## Central exercise library (v1.6.1)

The Exercises menu uses one persistent `exercises` list of IDs and current names. Workout and session records refer to it through `catalogId`; card-instance IDs stay unchanged. History, hints and last-set lookup use those references. Historical name fields remain snapshots; renaming changes only the central name. There is no second progression store, runtime name-based identity fallback, alias list, automatic merge, or exercise deletion management.

Direct library creation and Create Workout share name validation. New workout exercise definitions remain staged until the workout saves; cancelled/failed saves cannot leave phantom entries. Names are unique after trimming and case folding. Every template keeps its own starting weight/reps. Individual logging still reuses the session carousel, controls, set editor, notes, and persistence, with atomic finish and persistent input/set-edit drafts.

Storage keeps the existing key but uses format version 2. The reader still accepts version 1. Compatibility loading materializes old explicit IDs unchanged and adds references to the previous name groups for unidentified exercises. This preserves the existing history grouping, not a claim that matching historical names prove identity. The conversion is idempotent, uses a candidate state, and never writes during loading. Ambiguous IDs/names, unnamed unidentified records, or incomplete v2 references reject conversion; original bytes remain available through the recovery export and edits cannot overwrite them. Failed guarded writes leave original storage intact. Older clients reject v2 data instead of maintaining a stale inferred library.

Full backups include all definitions, even never-used library-only exercises. Category exports include referenced definitions. Category imports validate all incoming definitions/references and retained references before one atomic replacement of their collection plus additive library entries. They never replace the complete library or silently rename existing definitions. Same-ID historical snapshots may have older names; conflicting authoritative definitions or same-name/different-ID definitions are rejected. Repeating category imports replaces rather than appends history. Old category imports reuse stable legacy IDs even after the central name changes.

Deleting templates retains exercises and history and is blocked for the active workout. Resume Workout remains available even if a category import replaces/removes its template; finishing only updates defaults when both the template-card ID and catalogId still match. Existing controls, logged sets, set indices, notes, dates, finished flags and draft metadata remain intact across migration/import/rename.

Focused regression tests cover conversion/recovery, ambiguity rejection, import order/conflicts/references, library-only backups, direct/staged creation, duplicate names, rename/history/drafts, independent defaults, template deletion, category replacement during an active workout, and failed-save retry. The full Chromium suite and the existing WebKit CI checks include these scenarios. Linux browser checks do not replace real Android Chrome/iPhone Safari validation; retain the existing Safari/iOS 15.5+ API baseline and refresh older loaded tabs before switching formats.

Local validation for this revision: all 101 tests passed with zero failures/skips, including 26 new compatibility/library cases. JavaScript parsing, whitespace checks, and the library grid at 320/390/768px passed. The revision adds 103 net lines to the application compared with the previous PR implementation; no runtime packages, backend, build step, or additional runtime files were introduced. WebKit runs through the existing CI installation/checks because local Linux browser libraries are unavailable.
