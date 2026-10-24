# Production-readiness review — release candidate 1.5.1

Reviewed branch `improve/pwa-reliability`, the complete application, the previous technical report, and the three optimization commits:

- `db43230`: local-data protection, validation, accessible controls, and initial tests.
- `a04de56`: scope-specific worker caches and protected offline assets.
- `02db7fd`: browser regressions, CI, and technical documentation.

## Assessment

**The updated-client Chromium workflows are suitable for release review. Broad Safari/iOS release sign-off remains conditional on the device checks below.** No known data-loss defect remains in the workflows exercised by the 55 passing tests. This is not a claim of Safari or iOS execution: WebKit installation was blocked, and no Apple device was available. Do not treat the new CI WebKit job as passed until it actually runs.

Rollout requires refreshing or closing older app tabs before concurrent editing. A new app cannot retroactively stop old JavaScript from writing localStorage. Version **1.5.1** is shown on Home to identify the protected code; the data schema remains **1**. No merge, publication, deployment, remote CI run, or live-infrastructure change was performed.

## Concurrent-tab protection

The old synchronous whole-state writes allowed a tab with stale memory to replace another tab's records. A storage event or a read-then-write comparison alone cannot make that operation atomic across browser processes.

The new implementation holds one **exclusive Web Lock**, named after the existing `racked_state_v1` key, for the editable document's lifetime. This intentionally permits one editor at a time rather than attempting ambiguous field merges. Other updated tabs remain inert and can export their loaded snapshot. Closing or navigating away releases ownership; the next waiting tab reads current storage before enabling its UI. No lease timers, localStorage lock keys, polling, migration, server, or runtime dependency is introduced.

Safety details:

- `saveState` independently requires ownership; bypassing UI inertness cannot save from a waiting tab. Full-backup recovery does not bypass this check.
- Every save compares the actual raw stored bytes with the editor's observed bytes. Storage events also check current bytes, including storage-clear events. Unexpected outside changes freeze the stale editor instead of overwriting the newer data.
- Conflict export preserves the local snapshot and unsaved create/measurement/modal field values in supplemental draft metadata. Existing metadata names are preserved. Draft metadata is for manual recovery; a full import does not silently turn draft form fields into saved workouts or measurements.
- `pagehide` aborts a pending request or releases ownership; `pageshow` reacquires it. An unchanged snapshot preserves existing form drafts and open editors. A resumed editor whose snapshot changed stays blocked, allowing export/reload rather than applying old form input to newer records.
- Browsers without usable Web Locks fail closed: saved data remains exportable but writes are blocked. Serve via HTTPS or localhost. Never fall back to a racy localStorage-only pseudo-lock.
- A background/suspended editing tab retains ownership until navigation/closure. Waiting users must close that editor; there is no unsafe forced takeover.

The lock covers updated documents sharing the same browser storage context. It does not coordinate separate profiles/devices or synchronize isolated Safari/Home Screen stores. A legacy client that ignores Web Locks can still race and overwrite data; the raw-byte guard detects observable changes but cannot serialize the legacy writer. Refresh all old tabs during rollout.

## Confirmed regressions fixed

1. **Unknown exercise metadata was lost when editing or reordering a workout.** Draft and save construction now copy existing exercise properties before overriding edited values. Existing notes and metadata survive.
2. **Large finite legacy weights overflowed the stepper's multiplication.** Infinity became JSON `null`, later restoring as zero. Rounding now avoids intermediate overflow; logging explicitly refuses non-finite values. Ordinary decimal rounding and zero clamping remain unchanged.
3. **Clipboard fallback reported success when copying returned `false`.** The boolean result is now checked; failed or denied copying shows the manual-copy fallback.
4. **Modal height lacked a legacy viewport fallback.** `100vh` precedes `100dvh`, matching the main viewport's fallback strategy. This is a static compatibility improvement, not a device-reproduced Safari bug.

The previous data-validation, recovery, retry, note-preservation and offline-cache fixes remain intact. No new service-worker defect was confirmed, so its proven cache strategy was retained. Imports still validate before confirmation; quota failures preserve stored bytes; malformed stored data remains recoverable without silent replacement.

## Safari/iOS: evidence and limits

**Actually tested:** Linux Chromium 154.0.8037.57 through Playwright 1.62.1. Tests inject storage and clipboard failures and exercise offline relaunch, but those are Chromium scenarios, not Safari measurements.

**Attempted but blocked:** Playwright WebKit installation using the normal proxy and TLS verification returned HTTP 403 `Domain forbidden` for `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`. No unverified binary or verification bypass was used. No WebKit tests executed or passed in this environment.

**Static analysis:** Modern Safari/iOS supports the app's baseline APIs (Web Locks from 15.4, `inert` from 15.5; the project therefore documents Safari/iOS 15.5+). Relative manifest/start/scope/icon URLs suit subdirectory hosting. Apple standalone and touch-icon metadata, safe-area padding, `vh`→`dvh` fallback, and canonical worker cache URLs remain appropriate. Feature detection blocks unsafe editing when locking is unavailable. Standard version-1 exports use ISO timestamps/calendar dates rather than browser-specific date syntax.

localStorage and CacheStorage are not permanent backups: private/restricted modes, storage quotas, clearing, or browser/OS eviction can remove or deny them. An offline first launch without a populated cache cannot succeed. Safari browser and Home Screen storage can differ; do not promise automatic data transfer between them.

Before broad Safari/iOS sign-off, use supported iPhone/iPad Safari and a Home Screen installation to verify:

| Device scenario | Required result |
| --- | --- |
| Fresh HTTPS launch, then Add to Home Screen | Correct identity/icons/scope; standalone launch opens Racked |
| Create workout, log sets/notes, close and reopen | Saved records and unfinished session persist |
| Two Safari tabs/windows | One editor; waiting tab loads latest data after ownership transfer |
| Background/resume, back navigation, process termination | No stale overwrite; draft and conflict messaging match the documented contract |
| Update an existing installation, then offline relaunch | Current shell is cached; saved workout data survives; old tabs are refreshed |
| Full/category backup export and import through Files | Download is usable; notes/metadata/session controls round-trip; cancel does not replace data |
| Virtual keyboard, portrait/landscape, zoom, VoiceOver | Fields, modals, focus, status and actions remain usable |
| Restricted/private storage and quota failure | Clear failure feedback; no false save/export success or accidental overwrite |
| Safari versus Home Screen storage context | Data expectations are explicit; Full Backup transfer works when contexts differ |

## Verification and review preparation

- Original baseline: **38/38 tests passed before changes**.
- Updated suite: **55 passed, 0 failed, 0 skipped** via `npm test`.
- An intermediate repeat exposed a test-harness race: the imported-ID test reloaded during asynchronous file reading/confirmation. The helper now waits for the import input to reset (including failure/cancel paths) before navigating; the focused regression and final full run pass.
  - All original 38 retained; the data unit harness explicitly models the owning tab.
  - 9 new multi-tab/lifecycle/conflict tests, 5 compatibility/failure tests, 3 metadata/numeric regressions.
- Multi-tab tests use actual independent pages in one Chromium context and real Web Locks/localStorage. The pagehide/pageshow cases dispatch synthetic lifecycle events; they do not establish real-device BFCache eligibility or suspension behavior.
- Inline JavaScript, worker JavaScript, manifest paths and `git diff --check` pass.
- Runtime dependency count remains **zero** (`npm ls --omit=dev --all` reports an empty production tree). Only the original five static production assets are required; no build or server API was added. Playwright remains development-only.
- Existing Chromium CI remains; a WebKit compatibility/concurrency job is added for environments able to download that engine. Neither remote job was run in this task.

The main code-quality decision is the document-lifetime lock: it keeps the existing synchronous mutation/rollback contract instead of making every form handler asynchronously interleavable. Metadata copying is simpler and less lossy than maintaining a narrow field whitelist. Existing helper and worker structure was retained where tests already substantiate it.

Remaining nonblocking opportunities are duplicate-ID diagnostics, accessible chart data tables, and measured large-history storage/rendering work. They do not justify a storage migration or framework rewrite in this release candidate.
