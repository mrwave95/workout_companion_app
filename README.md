# Racked — Workout Log

A self-contained PWA for workout decks, set logging, body measurements, progress charts and JSON backups. All records stay in this browser; there is no account or remote synchronization.

## Run

With Python 3 installed, run from the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Production needs only `index.html`, `sw.js`, `manifest.json` and the two PNG icons. Serve them together over HTTPS; localhost also supports development. There is no build step, backend, API key or runtime package dependency. Subdirectory hosting is supported.

## Check changes

Node.js 20+ and Playwright are development tools only:

```sh
npm ci
npx playwright install chromium
npm test
```

Tests start temporary servers and isolated browser contexts. Chromium uses `CHROMIUM_PATH`, `/usr/bin/chromium` when available, or the Playwright download. On Linux CI, `npx playwright install --with-deps chromium webkit` also installs system prerequisites. In a cloud shell with a read-only home cache, use `npm ci --cache /tmp/racked-npm-cache`.

Data and worker checks can run without a browser:

```sh
node --test tests/data.test.cjs tests/sw.test.cjs
```

For the additional WebKit checks, install that engine and run:

```sh
npx playwright install webkit
RACKED_TEST_BROWSER=webkit node --test --test-concurrency=1 tests/compat.test.cjs tests/concurrency.test.cjs tests/exercises.test.cjs
```

CI runs both sets of browser checks. Linux WebKit is not a substitute for iPhone/iPad testing.

## Exercises

Open **Exercises** below **Create a Workout** to log any exercise already in your workouts or history. The two-column library shows the last logged set; selecting a card opens the usual set logger. **Finish** saves that exercise's progression immediately without creating a workout template.

Unfinished exercises, notes, typed controls (including incomplete input), and set-editor drafts are saved locally. Reopen with **Resume Exercise** or the same library card. Save or cancel a pending set edit before finishing. Starting another exercise or workout asks before discarding the active session; there is still only one active session at a time.

New exercise records have a persistent `catalogId`, separate from template-card `id` and session `exerciseId`. Reusing a known exercise in another workout shares its progression. Different explicit IDs stay separate even when their names match; select the appropriate suggestion when names are ambiguous. Full backups and category exports retain these IDs.

Older records lack that identity. Their existing case-insensitive name groups remain visible, with a notice, and original records are not rewritten. Continuing a legacy exercise uses a stable compatibility ID for its existing name group. Identical historical names might have meant different exercises, and different names might have been renames; Racked cannot safely resolve those cases from old data. It does not automatically relink explicit IDs or rename historical groups.

## Protect your data

App version **1.6.0** retains the `racked_state_v1` key and version-1 JSON format. Export Full Backups regularly: browser storage can be denied, cleared or evicted. Use export/import to transfer data between devices or separate Safari/Home Screen storage contexts.

Only one tab can edit shared browser storage at a time. Close the editor to let a waiting tab load the latest data. Refresh **all older Racked tabs** before using this release; older loaded code does not honor the writer lock. Editing requires HTTPS/localhost and Web Locks; unsupported browsers can still export saved data. Safari/iOS 15.5+ meets the API baseline by static analysis, but Apple-device validation is pending.

See [the engineering review](docs/technical-review.md) for safeguards, recovery behavior, size tradeoffs, test evidence and remaining release checks.

## GitHub Pages publishing

Keep the existing **Deploy from a branch → main → /(root)** setup. No build step or publishing workflow is needed. The automated testing workflow remains separate and does not deploy.

GitHub publishes changes to `main`, so merging or pushing directly to `main` requires explicit approval. Preserve the existing site URL, domain settings and relative asset paths. Tests, documentation and tooling stay in the repository; the app loads only its runtime assets.
