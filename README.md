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
- All personal records remain in this browser's `localStorage` under `racked_state_v1`. The version-1 JSON format is retained. There is no account or remote synchronization. Regularly export a Full Backup, especially before clearing site data or changing devices.

Full Backup imports require `workouts`, `sessions`, and `measurements` arrays, and may include `activeSession`. Category imports replace only the selected collection. Valid version-1 IDs, metadata and unfinished-session controls survive round trips. Invalid imports are rejected before confirmation. Finite negative legacy values remain readable; new input requires non-negative numbers and whole rep counts.

If existing saved data cannot be read, the app leaves its bytes untouched and prevents accidental replacement. **Export Full Backup** downloads those original bytes for recovery; restoring a valid Full Backup explicitly replaces them. Failed writes revert to the last saved state and report failure.

## Offline behavior and updates

The worker revalidates app assets with the network, caches only successful complete responses, and uses the previous good copy during offline or server failures. With an existing cache, a stalled request falls back after three seconds; a later network response can still refresh the cache. Root and `index.html` launch URLs, including query parameters, share a canonical cached shell. New workers precache before activating; failed precaches leave the existing installation intact.

Updates are delivered through normal service-worker checks and subsequent page loads. An already open page continues its loaded code; there is no automatic reload that could interrupt a workout. Old caches belonging to this scope are removed. Ambiguous legacy `racked-cache-v*` caches are retained because older versions shared those names across paths; unrelated applications' caches are never deliberately removed.

See [the technical review](docs/technical-review.md) for findings, validation, and follow-up work.
