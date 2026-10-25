# Working on Racked

## Purpose and architecture

- Racked is a local-only workout and body-measurement PWA: create/reorder workout
  decks, log/edit/delete sets, finish/reopen exercises, resume sessions, chart
  progress, log individual exercises from the Exercises library, and import/export
  JSON backups.
- Keep the static, self-contained architecture: UI, CSS, state and charts live in
  `index.html`; offline caching lives in `sw.js`; `manifest.json` and two PNGs
  provide install metadata. No production packages, API, bundler or build step.
- Read `README.md` for commands and `docs/technical-review.md` for current
  engineering tradeoffs, browser evidence and release limitations.

## Data integrity

- `state.exercises` owns persistent exercise IDs/current names. `catalogId` is the
  sole reference; template `id` and session `exerciseId` remain card-instance IDs.
  Names are unique via trim/lowercase. Rename only the central name; preserve
  historical name snapshots. Never merge different IDs by name or delete unused
  library entries when templates/categories are removed.
- Format v2 remains under `racked_state_v1`; load/import accepts v1 and converts
  unambiguous legacy name groups once, with additive references. Keep compatibility
  ID derivation inside validation/import, never in runtime history lookup. Reject
  conflicting names/identities or incomplete v2 references without replacing data.
- Individual logging uses `activeSession.kind === 'exercise'` and normal history,
  never a saved template. Preserve `draftInputs`, `editSetDraft`, notes, controls,
  IDs, timestamps and unknown metadata through conversion, restarts and backups.
  Finishing atomically archives once and clears the active record.
- Full backups include library-only exercises; category exports include referenced
  definitions. Category imports add definitions and replace only their collection,
  preserving retained history/active references. Workout starting values stay local
  to each template. Stage new definitions until the workout saves successfully.
- Validate imports before confirmation/replacement. Category imports affect only
  their category; full backups require all three collections. Do not introduce
  destructive migrations or silently normalize invalid saved data into deletion.
- Respect `saveState()`'s boolean result. Failed saves roll back to the durable
  snapshot; never show success, navigate away, or retain stale editor references
  after rollback. Corrupt saved bytes must remain exportable for recovery.
- Retain the document-lifetime Web Lock and raw-storage conflict checks. Only the
  owning tab may write; waiting/restored tabs must not overwrite newer data.
  Unsupported locking fails closed with export available. Preserve conflict
  backups and unsaved-draft metadata; do not substitute a racy storage-only lock.

## PWA, security and usability

- Keep asset, manifest and worker URLs relative for GitHub Pages subdirectories.
  Preserve worker scope, canonical root/index/query fallback, successful-response
  caching, scoped cache ownership and tracked writes. Never delete other apps'
  caches or replace a good offline shell with errors/partial responses.
- Preserve offline operation, installability and update delivery without forcing
  reloads that interrupt a workout. Never cache personal records in the worker.
- Treat imported names, IDs and notes as untrusted. Escape values inserted into
  HTML; validate finite numeric/date inputs. Never commit credentials or records.
- Preserve the visual identity, mobile safe areas, rotation behavior and zoom.
  Keep labels, native keyboard controls, modal focus/Escape handling, reduced
  motion, and inactive carousel slides out of keyboard navigation.
- Chromium coverage is actual browser evidence; Safari/iOS compatibility analysis
  and Linux WebKit checks are not real-device validation. Keep that distinction.

## Changes and verification

- Follow existing plain JavaScript, two-space indentation and small named helper
  conventions. Keep changes focused; prefer native APIs and proven fixes over
  frameworks, speculative abstractions, extra dependencies or broad rewrites.
- Preserve existing features and stored data. Add focused regressions for bugs;
  reuse `tests/browser-helper.cjs` rather than duplicating browser infrastructure.
- Run locally: `python3 -m http.server 8000 --bind 127.0.0.1` from the repo root.
- Test tooling: Node.js 20+, `npm ci`, `npx playwright install chromium`, then
  `npm test`. `CHROMIUM_PATH` selects a browser; `/usr/bin/chromium` is reused
  when available. A restricted home cache can use `--cache /tmp/racked-npm-cache`.
- Unit checks: `node --test tests/data.test.cjs tests/library-data.test.cjs tests/sw.test.cjs`.
- Optional second engine: `npx playwright install webkit`, then
  `RACKED_TEST_BROWSER=webkit node --test --test-concurrency=1 tests/compat.test.cjs tests/concurrency.test.cjs tests/exercises.test.cjs tests/library.test.cjs`.
- Run relevant checks after edits, the full suite before review, and
  `git diff --check`. Report failures, skips and unverified browsers honestly.

## Publishing boundaries

- Keep GitHub Pages **Deploy from a branch → main → /(root)**. No publishing
  workflow or build system is needed. Keep the automated testing workflow.
- Preserve the existing URL, domain settings and relative asset/worker paths.
  Keep tests, docs and development tooling in the repository.
- Changes to `main` publish the site. Merging, pushing directly to `main`, changing
  live Pages settings, and deployment require explicit user approval. A request
  to push a review branch or create a PR does not authorize those actions.
