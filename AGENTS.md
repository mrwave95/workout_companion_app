# Working on Racked

## Purpose and architecture

- Racked is a local-only workout and body-measurement PWA: create/reorder workout
  decks, log/edit/delete sets, finish/reopen exercises, resume sessions, chart
  progress, and import/export JSON backups.
- Keep the static, self-contained architecture: UI, CSS, state and charts live in
  `index.html`; offline caching lives in `sw.js`; `manifest.json` and two PNGs
  provide install metadata. No production packages, API, bundler or build step.
- Read `README.md` for commands and `docs/technical-review.md` for current
  engineering tradeoffs, browser evidence and release limitations.

## Data integrity

- Preserve `racked_state_v1` and its version-1 JSON compatibility: `workouts`,
  `sessions`, `measurements`, and nullable `activeSession`. Keep IDs, notes,
  active-session controls, and unknown metadata when editing or round-tripping.
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
- Unit checks: `node --test tests/data.test.cjs tests/sw.test.cjs`.
- Optional second engine: `npx playwright install webkit`, then
  `RACKED_TEST_BROWSER=webkit node --test --test-concurrency=1 tests/compat.test.cjs tests/concurrency.test.cjs`.
- Run relevant checks after edits, the full suite before review, and
  `git diff --check`. Report failures, skips and unverified browsers honestly.

## Publishing boundaries

- `.github/workflows/pages.yml` stages only the five runtime files. If adding a
  required asset, update its explicit allowlist and worker precache as needed.
- Keep tests, docs, this file and development tooling in Git, outside the site
  artifact. Publishing must retain the existing URL, scope and domain settings.
- Merging, changing live Pages settings, dispatching deployment, and deploying
  require explicit user approval. A request to commit/push/create a PR alone
  does not authorize any of those actions. Never auto-deploy a review branch.
