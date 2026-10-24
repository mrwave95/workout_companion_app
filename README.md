# Racked — Workout Log

A small, offline-first workout and body-measurement tracker. Create workout decks, log and edit sets, resume an unfinished session, review estimated one-rep-max and measurement charts, and import/export JSON backups.

## Run locally

From the repository root, with Python 3 installed:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open the local server in a browser. A secure context (HTTPS in production, or localhost in development) enables service workers. There are no runtime packages, API keys, backend services, or production build steps. Deploy the five original static files together: `index.html`, `sw.js`, `manifest.json`, and both PNG icons. The existing GitHub Pages subdirectory layout is supported.

## Development checks

Node.js 20+ is needed only for the test tooling:

```sh
npm ci
npx playwright install chromium
npm test
```

The browser suites use `/usr/bin/chromium` when present, otherwise Playwright's installed Chromium. Set `CHROMIUM_PATH` to choose another executable. On Linux CI, `npx playwright install --with-deps chromium` installs required system libraries too. In restricted cloud shells, `npm ci --cache /tmp/racked-npm-cache` avoids a read-only home cache.

Tests start their own temporary HTTP servers and use isolated browser storage; they do not require or alter a running development server. `.github/workflows/test.yml` runs the same checks on pushes and pull requests. To run only the data and service-worker unit tests:

```sh
node --test tests/data.test.cjs tests/sw.test.cjs
```

## Architecture and data

- `index.html` contains the UI, styles, view router, state, input validation, canvas charts and backup logic. Keeping the application self-contained preserves simple static deployment.
- `manifest.json` supplies install metadata and icons.
- `sw.js` precaches the four app assets and provides network-first offline fallback. Cache names include the registration scope, allowing multiple apps on one origin.
- All personal records remain in this browser's `localStorage` under `racked_state_v1`. The version-1 JSON format is retained. There is no account or remote synchronization. App version 1.5.1 keeps the same version-1 storage format. Regularly export a Full Backup, especially before clearing site data or changing devices.

Full Backup imports require `workouts`, `sessions`, and `measurements` arrays, and may include `activeSession`. Category imports replace only the selected collection. Valid version-1 IDs, metadata and unfinished-session controls survive round trips. Invalid imports are rejected before confirmation. Finite negative legacy values remain readable; new input requires non-negative numbers and whole rep counts.

If existing saved data cannot be read, the app leaves its bytes untouched and prevents accidental replacement. **Export Full Backup** downloads those original bytes for recovery; restoring a valid Full Backup explicitly replaces them. Failed writes revert to the last saved state and report failure.

## Offline behavior and updates

The worker revalidates app assets with the network, caches only successful complete responses, and uses the previous good copy during offline or server failures. With an existing cache, a stalled request falls back after three seconds; a later network response can still refresh the cache. Root and `index.html` launch URLs, including query parameters, share a canonical cached shell. New workers precache before activating; failed precaches leave the existing installation intact.

Updates are delivered through normal service-worker checks and subsequent page loads. An already open page continues its loaded code; there is no automatic reload that could interrupt a workout. Old caches belonging to this scope are removed. Ambiguous legacy `racked-cache-v*` caches are retained because older versions shared those names across paths; unrelated applications' caches are never deliberately removed.

## Multiple tabs and supported browsers

Only one tab per shared browser storage context may edit at a time. Additional tabs display a waiting screen, can export their current snapshot, and become editable after the active editor closes or navigates away. On handoff the new editor reads the latest saved data. The same rule covers multiple windows or Racked paths sharing this origin and storage key.

If saved bytes change outside the editor, saving pauses rather than overwriting them. Export that tab's data before reloading. A conflict backup is valid version-1 JSON with additional `rackedRecoveryDraft` metadata (suffixed if the name is already in use) containing unsaved form fields for manual recovery. Importing it restores saved records; it does not automatically apply those form drafts. The original outside data remains untouched until an explicit import.

Editing requires a secure context and Web Locks support; current Chromium and Safari/iOS 15.5+ meet the API baseline by static analysis. When locking is unavailable, the app permits backup export and blocks saves. Reload or close **all older Racked tabs** before using this release; older loaded code does not honor the new writer lock. The home-screen version label is now **1.5.1** so updated code can be identified.

Safari/iOS execution has not been validated in this environment. Linux WebKit compatibility checks can be run after installing that engine:

```sh
npx playwright install webkit
RACKED_TEST_BROWSER=webkit node --test --test-concurrency=1 tests/compat.test.cjs tests/concurrency.test.cjs
```

Linux WebKit supplements rather than replaces real iPhone/iPad testing. Safari tabs and Home Screen apps may use different storage contexts; use Full Backup export/import when switching contexts. Browser storage is subject to user clearing, private-mode restrictions, and OS/browser eviction. Keep external backups.

See [the production-readiness review](docs/production-readiness.md) for the current release assessment and device checklist.

See [the technical review](docs/technical-review.md) for findings, validation, and follow-up work.
