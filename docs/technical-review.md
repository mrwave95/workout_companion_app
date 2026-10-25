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

## Exercises library (v1.6.0)

The Exercises menu uses a two-column library drawn from templates, session history, and the active session. It reuses the session carousel, controls, set editor, notes, and persistence. An individual session is marked `kind: 'exercise'`; its synthetic workout reference does not create a workout template. Finish saves one normal history entry and clears the active session in one guarded write. Switching sessions still requires explicit discard confirmation.

`catalogId` is additive persistent identity on new template/session exercise records. Instance IDs remain intact. Library defaults, previous-performance hints, and charts use the same identity resolver; last-set defaults compare set timestamps, falling back to the session date for historical sets without a time. Explicit identities are never merged just because names match. Known-exercise suggestions carry identity, including when adding the same exercise to different templates. Identity lives on the records so category exports remain self-contained.

There is no destructive migration: old records without identity keep their existing name-based chart groups under a stable `legacy-name:` compatibility key. The library and progression view disclose that identical names may have represented different exercises. Neither shared spelling nor an old card ID can establish true historical identity, and this release does not retroactively relink records, split histories, deduplicate sets, or infer renames. Mixed identified/legacy imports can therefore show separate same-name history cards; this is deliberate rather than silently guessing a link.

Individual numeric input drafts and set-editor drafts persist on input, including incomplete strings, and reopen on resume. Invalid controls cannot log stale numeric values or finish; pending set edits must be saved or cancelled. Failed writes retain the durable snapshot, including on finish and editor retries. Full/category backups preserve optional IDs and draft metadata; malformed supplied identity/draft metadata is rejected before replacement.

Compatibility continues to target Android Chrome and Safari/iOS 15.5+ using the existing static architecture and browser API baseline. New Chromium regression coverage does not constitute real-device Apple validation. Refresh older loaded tabs before using the new version; older code cannot enforce the new identity semantics.

Validation for this change: all **75 tests passed** with zero failures/skips (58 existing plus 17 focused identity/library/draft/validation cases). Application JavaScript parsing, whitespace checks, and mobile layout checks at 320/390/768px passed; production dependencies remain empty. The new Exercises browser suite is included in the existing WebKit CI command. Local WebKit installation was attempted with a writable cache but both download hosts returned HTTP 403 `Domain forbidden`; it was not run locally. Real Android Chrome and iPhone Safari validation remains outstanding.
