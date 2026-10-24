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
RACKED_TEST_BROWSER=webkit node --test --test-concurrency=1 tests/compat.test.cjs tests/concurrency.test.cjs
```

CI runs both sets of browser checks. Linux WebKit is not a substitute for iPhone/iPad testing.

## Protect your data

App version **1.5.1** retains the `racked_state_v1` key and version-1 JSON format. Export Full Backups regularly: browser storage can be denied, cleared or evicted. Use export/import to transfer data between devices or separate Safari/Home Screen storage contexts.

Only one tab can edit shared browser storage at a time. Close the editor to let a waiting tab load the latest data. Refresh **all older Racked tabs** before using this release; older loaded code does not honor the writer lock. Editing requires HTTPS/localhost and Web Locks; unsupported browsers can still export saved data. Safari/iOS 15.5+ meets the API baseline by static analysis, but Apple-device validation is pending.

See [the engineering review](docs/technical-review.md) for safeguards, recovery behavior, size tradeoffs, test evidence and remaining release checks.

## GitHub Pages publishing

`.github/workflows/pages.yml` is manual-only, requires explicit publishing approval, and accepts only the default branch. It runs the automated checks, then stages just the five runtime files; tests, docs and tooling remain in Git but outside the site artifact.

If Pages currently uses **Deploy from a branch**, an approved settings change to **GitHub Actions** is required before merging to prevent the old branch-based rule from publishing repository files. Retain the existing domain/URL settings. Live settings could not be read here because GitHub API access was blocked; no setting was changed and no deployment was dispatched. After approval and merge, run **Publish Racked to GitHub Pages** on the default branch with its publishing checkbox enabled.
