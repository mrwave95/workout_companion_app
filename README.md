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
node --test tests/data.test.cjs tests/library-data.test.cjs tests/sw.test.cjs
```

For the additional WebKit checks, install that engine and run:

```sh
npx playwright install webkit
RACKED_TEST_BROWSER=webkit node --test --test-concurrency=1 tests/compat.test.cjs tests/concurrency.test.cjs tests/exercises.test.cjs tests/library.test.cjs
```

CI runs both sets of browser checks. Linux WebKit is not a substitute for iPhone/iPad testing.

## Exercises

Open **Exercises** below **Create a Workout** to use the shared, persistent library. **Add Exercise** creates an exercise directly; Create Workout can select an existing exercise or stage a new one until **Save Workout**. Cancelling a workout draft does not add library entries. Names must be unique ignoring capitalization and surrounding whitespace.

The two-column library shows each exercise's last logged set. Select a card to use the usual set logger. **Finish** saves individual progression without creating a workout template. **Rename** changes the shared name without changing exercise identity or historical names and sets. Deleting a workout keeps its library exercises. Each workout retains its own starting weight/reps; individual logging uses the last logged set or the default starting values.

Unfinished exercises, notes, typed controls (including incomplete input), and set-editor drafts are saved locally. Reopen with **Resume Exercise**, **Resume Workout**, or the same library card. Save or cancel a pending set edit before finishing. Starting another exercise or workout asks before discarding the active session; there is still only one active session at a time.

The saved `exercises` list owns current names and identities. Workout/session `catalogId` references this list; template-card `id` and session `exerciseId` remain instance references. Historical names are snapshots, never the live name source. Full backups include the complete library, including exercises never used in a workout. Workouts/progression exports include their referenced library definitions; category imports add definitions without removing unrelated exercises or active-session references.

Older version-1 backups remain readable. Unidentified records keep their previous case-insensitive name groups under stable compatibility IDs, with an uncertainty notice. Original IDs, names, notes, sets, timestamps, drafts, and unknown metadata are preserved; only missing library references are added. Historical spelling cannot prove true identity or a rename. Conflicting IDs/names, missing version-2 definitions, and unnamed legacy records are rejected with an explanation instead of being guessed or merged. Failed conversion/import/save does not overwrite the original storage; the original bytes remain exportable through Full Backup when recovery is needed.

## Protect your data

App version **1.6.1** retains the `racked_state_v1` storage key and saves format version 2. Version-1 backups are converted on load/import; older app versions reject version-2 data rather than silently changing it. Export Full Backups regularly: browser storage can be denied, cleared or evicted. Use export/import to transfer data between devices or separate Safari/Home Screen storage contexts.

Only one tab can edit shared browser storage at a time. Close the editor to let a waiting tab load the latest data. Refresh **all older Racked tabs** before using this release; older loaded code does not honor the writer lock. Editing requires HTTPS/localhost and Web Locks; unsupported browsers can still export saved data. Safari/iOS 15.5+ meets the API baseline by static analysis, but Apple-device validation is pending.

See [the engineering review](docs/technical-review.md) for safeguards, recovery behavior, size tradeoffs, test evidence and remaining release checks.

## GitHub Pages publishing

Keep the existing **Deploy from a branch → main → /(root)** setup. No build step or publishing workflow is needed. The automated testing workflow remains separate and does not deploy.

GitHub publishes changes to `main`, so merging or pushing directly to `main` requires explicit approval. Preserve the existing site URL, domain settings and relative asset paths. Tests, documentation and tooling stay in the repository; the app loads only its runtime assets.
