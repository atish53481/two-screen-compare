# Two Screen Compare — QA Vision

Compare two environments of the same web application (typically **DEV** vs **PROD**) by using one and watching the other follow.

You click and type in a DEV browser window. QA Vision captures each action, finds the equivalent element in PROD, replays it there **safely**, and compares both screens after every step. Differences are streamed to a dashboard, stored in a run history, and exported as HTML, PDF, Excel, CSV or JSON reports.

> **Status: full-spec implementation with the documented gaps.** See [What works today](#what-works-today) and [Known limitations](#known-limitations) before relying on it. The full target specification is in [`QA_Vision_Dynamic_Two_App_Comparison_Grok.md`](QA_Vision_Dynamic_Two_App_Comparison_Grok.md) and [`Master Prompt AI-Powered DEV vs PRO.md`](Master%20Prompt%20AI-Powered%20DEV%20vs%20PRO.md).

---

## Contents

- [Quick start](#quick-start)
- [How a comparison works](#how-a-comparison-works)
- [What works today](#what-works-today)
- [PROD safety](#prod-safety)
- [Ignore rules](#ignore-rules)
- [Configuration (environment variables)](#configuration-environment-variables)
- [Tests](#tests)
- [Project structure](#project-structure)
- [Development notes](#development-notes)
- [Known limitations](#known-limitations)

---

## Quick start

**Requirements:** Node.js 22.13+ (the store uses the built-in `node:sqlite`) and npm. Windows, macOS or Linux.

```bash
git clone https://github.com/atish53481/two-screen-compare.git
cd two-screen-compare

npm install                              # root helper (concurrently)
cd qa-vision   && npm install && cd ..   # also downloads Playwright Chromium
cd sample-dev  && npm install && cd ..
cd sample-prod && npm install && cd ..
```

Start everything:

| What | Windows | Any OS |
|---|---|---|
| QA Vision dashboard (port 3001) | `Start QA Vision.bat` | `cd qa-vision && npm run start:real` |
| Sample DEV app (port 3002) | `Start DEV.bat` | `cd sample-dev && npm run dev` |
| Sample PROD app (port 3003) | `Start PROD.bat` | `cd sample-prod && npm run dev` |

Then open **http://localhost:3001**.

> The dashboard is unauthenticated and intended for localhost use only. Set `QA_VISION_HOST` only on a trusted network.

> Use `npm run start:real` (custom server with Socket.IO), not `npm run dev`. Without it, the dashboard gets no live updates.

The sample apps are optional **test fixtures** with deliberate differences (banner, user count, copy, colors). Their login is `test@acme.com` / `password123`. QA Vision works with any pair of http/https URLs.

---

## How a comparison works

1. **Profiles tab.** Create or select a profile with a DEV URL, PROD URL, labels, PROD safety policy, safety allowlist and ignore rules. Click **Save Profile**.
2. **Launch Environments.** Two separate Chromium windows open, titled *QA Vision DEV* and *QA Vision PROD*. Cookies, storage and logins are fully isolated between them. A baseline comparison of the landing pages runs immediately.
3. **Work only in the DEV window.** Each click, typed value, dropdown change and back/forward navigation is replayed in PROD, in order.
4. After each step (or burst of steps), QA Vision captures both screens. It compares visible text and screenshot pixels, then records findings with evidence: DEV, PROD and diff screenshots.
5. **Pause / Resume, Resynchronize Browsers, Stop** in the sidebar.
   - *Resync* moves PROD to the page matching DEV's current URL and re-runs the comparison. It does not copy in-page state such as typed values or open dialogs.
   - *Stop* waits for in-flight work, then closes the browsers. Results stay on screen.
6. **Export PDF Report.** Produces a consolidated report of the whole run: summary, findings with screenshots and step references, and the execution log.

---

## What works today

Each row names the test that proves it. Paths are relative to `qa-vision/`. "Implemented, not verified in CI" means the code and its mocked unit tests exist, but it was never exercised against the real service.

| Area | Status | Proven by |
|---|---|---|
| Runtime-configurable DEV/PROD URL pairs, saved profiles, duplicate | ✅ | `tests/ui/dashboard.ui.js` (profile duplicate), `tests/unit/store.test.js` |
| Two isolated Playwright browsers, DEV action recorder (click, input, change, select, back/forward) | ✅ | `tests/e2e/sync.e2e.js` |
| Double-click, hover and keyboard capture and replay | ✅ | `tests/e2e/actions.e2e.js` |
| Element matching on PROD (test id, id, role + name, label, name, placeholder, aria-label, input type); only when exactly one element matches, never guessed | ✅ | `tests/e2e/safety.e2e.js` |
| PROD safety (read-only default, network write guard, allowlist) | ✅ [details](#prod-safety) | `tests/e2e/safety.e2e.js`, `tests/e2e/allowlist.e2e.js` |
| Ordered replay queue; every step covered by a comparison; out-of-sync + Resync; Stop draining | ✅ | `tests/e2e/sync.e2e.js` |
| Launch → Start Comparison → Pause / Start again → Stop flow: Launch opens DEV + PROD in a Ready phase (nothing replicated or compared, live frames and PROD guard active); Start syncs PROD to DEV's page and compares; Start again resyncs; Stop works from any phase | ✅ | `tests/e2e/start-flow.e2e.js`, `tests/ui/dashboard.ui.js` (button flow, `start` route 404/409) |
| Configurable capture: viewport, thresholds, masking, scope | ✅ | `tests/unit/capture-settings.test.js`, `tests/e2e/capture.e2e.js` |
| Structured in-page snapshot extraction (with sensitive-field redaction) | ✅ | `tests/e2e/extract.e2e.js` |
| DOM structure and form-constraint diff | ✅ | `tests/unit/dom-diff.test.js`, `tests/e2e/comparisons.e2e.js` |
| Computed CSS and layout diff | ✅ | `tests/unit/css-diff.test.js`, `tests/e2e/comparisons.e2e.js` |
| Accessibility checks | ✅ | `tests/unit/a11y-diff.test.js`, `tests/e2e/comparisons.e2e.js` |
| Configurable data rules (numeric tolerance, date/currency, null = empty, table diff) | ✅ | `tests/unit/data-rules.test.js`, `tests/e2e/comparisons.e2e.js` |
| Network/API and console/page-error comparison (secrets redacted) | ✅ | `tests/unit/runtime-diff.test.js`, `tests/e2e/comparisons.e2e.js` |
| Text comparison + pixel diff + side-by-side evidence; de-duplication with occurrence counts | ✅ | `tests/e2e/sync.e2e.js` |
| Ignore rules (normalize / exclude), suppression counts logged | ✅ [details](#ignore-rules) | `tests/unit/engine-utils.test.js`, `tests/e2e/sync.e2e.js` |
| Finding classification, confidence, provenance, stable fingerprints | ✅ | `tests/unit/findings.test.js` |
| Mark expected differences (persisted per profile); highlight a finding's element in both browsers | ✅ | `tests/e2e/expected-highlight.e2e.js`, `tests/ui/dashboard.ui.js` |
| Encrypted secret store and profile auto-login, bound to the profile's origins | ✅ | `tests/unit/secrets.test.js`, `tests/unit/login-origin.test.js`, `tests/e2e/login.e2e.js` |
| SQLite store: profiles, run history, findings, expectations, secrets; legacy JSON migration | ✅ | `tests/unit/store.test.js` |
| Reports: HTML, JSON, Excel, CSV and PDF (summary, severity breakdown, evidence, redacted URLs and log text) | ✅ | `tests/unit/reports.test.js`, `tests/unit/reports-hardening.test.js`, `tests/ui/dashboard.ui.js` (HTML export) |
| Dashboard: live mirror view, timeline, finding filters, evidence viewer, history tab, profile settings | ✅ | `tests/ui/dashboard.ui.js` |
| Evidence route rejects path traversal; saved passwords never returned by the API | ✅ | `tests/ui/dashboard.ui.js` |
| API endpoint checks (GET-only, JSON path assertions) | ✅ | `tests/unit/data-sources.test.js`, `tests/unit/data-sources-wiring.test.js` |
| Read-only SQL guard for database checks | ✅ | `tests/unit/data-sources.test.js` |
| PostgreSQL read-only database comparison | **Implemented, not verified in CI.** Unit tests use an injected fake client; no QA_TEST_PG_URL was available, so nothing ran against a real server | `tests/unit/data-sources.test.js` (the real-server case is skipped without QA_TEST_PG_URL) |
| AI analysis (Anthropic, or any OpenAI-compatible API): grounded prompt, redaction, graceful failure, results merged into the stored run | **Implemented, not verified in CI.** No API key was available, so no real provider call was made. Redaction, prompt building, parsing and fallbacks are covered with mocks | `tests/unit/ai.test.js`, `tests/e2e/ai-race.e2e.js` |

Every finding has a `classification`: `EXPECTED_DIFFERENCE`, `UNMAPPED_OR_MISSING_FEATURE`, `REPLAY_FAILURE`, `SKIPPED_BY_SAFETY_POLICY`, `NOT_COMPARABLE` or an unclassified content difference, plus a confidence and the rule that produced it (see `lib/engine/findings.ts`).

---

## PROD safety

QA Vision points automation at production, so PROD is protected by default. Choose the policy per profile:

| Policy | Blocked on PROD |
|---|---|
| **`read-only`** (default) | Form submissions; clicks on destructive wording (delete, remove, pay, checkout, transfer, refund, cancel order…); **every HTTP request that isn't GET, HEAD or OPTIONS** |
| `allow-safe` | Destructive-wording clicks and HTTP `DELETE` |
| `full` | Nothing. A warning is logged at session start |

- **The network write guard is the hard guarantee.** Even if an innocent-looking click triggers a JavaScript `fetch`/`POST`, the request is aborted inside the PROD browser before it is sent.
- **Every block is audited.** It appears in the log (amber *SKIPPED*) and as a `SKIPPED_BY_SAFETY_POLICY` finding.
- **Safety allowlist** (Profiles tab, comma-separated):
  - Plain entries such as `sign in` or `login-submit` match the clicked element's text, test id or label. When an allowlisted action replays, PROD writes are allowed for 5 seconds, and each permitted request is logged.
  - `url:` entries such as `url:/api/auth/login` allow requests whose URL contains that fragment.
  - Typical use: allowlist the login button on a real login form, so PROD can sign in under `read-only`.
- **Target URL validation:**
  - Only `http`/`https` URLs are accepted.
  - Credentials inside URLs and cloud-metadata / link-local hosts are rejected.
  - To restrict targets further, set `QA_VISION_ALLOWED_HOSTS=example.com,localhost` (suffix match).
- **Secrets:**
  - Password fields, and fields named like tokens, OTP, CVV, card numbers, SSN or PIN, are shown as `[value redacted]` in every log, finding, snapshot and report.
  - Typed values are stripped from error messages.

---

## Ignore rules

Dynamic content would otherwise flood results with false positives. Rules are set per profile (Profiles tab, comma-separated):

| Rule | Effect |
|---|---|
| `timestamp` | Dates and times are normalized before comparing |
| `session-id`, `random`, `random-id` | UUIDs and long random tokens are normalized |
| `numbers` | All numbers are normalized (counts, totals) |
| `regex:<pattern>` | Text matching the pattern is normalized |
| `text:<fragment>`, or any other plain entry | Findings whose element or values contain it are excluded |

Nothing is hidden silently. Each comparison logs how many differences the rules suppressed, and which ones.

---

## Configuration (environment variables)

All variables are optional and server-side only. `qa-vision/.env.example` holds placeholders; never commit real values.

| Variable | Purpose |
|---|---|
| `QA_VISION_SECRET_KEY` | Key that encrypts stored login credentials. If unset, a key file is generated in the data directory. A wrong key means saved credentials cannot be decrypted and login falls back to manual |
| `QA_VISION_DATA_DIR` | Where the SQLite database and key file live. Default `qa-vision/data` |
| `QA_VISION_COMPARE_BUDGET_MS` | Per-comparison time budget. A comparison that exceeds it is cut short and logged. Mainly used by tests |
| `QA_VISION_AI_PROVIDER` | `anthropic` or `openai-compatible`. Unset disables AI analysis |
| `ANTHROPIC_API_KEY` | API key for the `anthropic` provider |
| `QA_VISION_AI_BASE_URL`, `QA_VISION_AI_API_KEY` | Endpoint and key for the `openai-compatible` provider (for example Grok) |
| `QA_VISION_AI_MODEL` | Model override. Anthropic default: `claude-opus-5-5` |
| `QA_VISION_PORT` | Dashboard port for `server.js`. Default 3001 |
| `QA_VISION_HOST` | Interface `server.js` binds to. Default `127.0.0.1` (loopback only). Requests are accepted when the Host header is `localhost`, `127.0.0.1` or `[::1]` (always), or equals this value when set; anything else gets 403. Set it to the address other machines use to reach you (not `0.0.0.0`), and only on a trusted network |
| `QA_VISION_DIST_DIR` | Next.js `distDir` override. `test:ui` sets `.next-ui` so it never clobbers a running dashboard's build |
| `QA_VISION_ALLOWED_HOSTS` | Restrict target hosts (suffix match) |
| `QA_VISION_HEADLESS` | `1` launches comparison browsers headless |
| `QA_VISION_ORPHAN_TIMEOUT_MS` | Milliseconds with no dashboard connected before the engine closes all running sessions (their runs are saved). Default `600000` (10 minutes). Reloading the dashboard reconnects to the running session instead |
| `QA_DEV_URL`, `QA_PROD_URL` | Point the test suites at other deployments |
| `QA_TEST_PG_URL` | Test only: a PostgreSQL connection string that enables the real-server database-check test |

---

## Tests

Run from `qa-vision/` (or `npm test` at the repo root):

```bash
npm run test:unit   # pure modules, no browsers
npm run test:e2e    # real headless Chromium against the sample apps
npm run test:ui     # dashboard UI test on its own server (port 3101)
npm test            # unit + e2e
```

`test:e2e` starts the sample apps if they aren't running and stops them afterwards. Run a single suite with `npm run test:e2e -- safety`. `test:ui` starts its own server with a temporary data directory and refuses to run if port 3101 is taken.

| Suite | Covers |
|---|---|
| `tests/unit/engine-utils.test.js` | URL validation, DEV to PROD URL mapping, ignore-rule normalization/exclusion |
| `tests/unit/findings.test.js`, `capture-settings.test.js` | Fingerprints, classification, capture settings normalization |
| `tests/unit/dom-diff.test.js`, `css-diff.test.js`, `a11y-diff.test.js` | DOM, CSS/layout and accessibility diffs |
| `tests/unit/data-rules.test.js`, `runtime-diff.test.js` | Data rules and table diff; network/console diff and redaction |
| `tests/unit/data-sources.test.js`, `data-sources-wiring.test.js` | API checks, read-only SQL guard, DB runner (fake client; real Postgres only with QA_TEST_PG_URL) |
| `tests/unit/secrets.test.js`, `login-origin.test.js` | Secret encryption, origin-bound credentials |
| `tests/unit/store.test.js` | SQLite store, migration |
| `tests/unit/ai.test.js` | AI redaction, prompt, parsing, fallbacks (mocked) |
| `tests/unit/reports.test.js`, `reports-hardening.test.js` | Report exports and their hardening |
| `tests/e2e/safety.e2e.js` | Read-only default; destructive/submit blocking; network write guard; ambiguous and missing element handling; navigation mapping; password redaction; URL rejection |
| `tests/e2e/allowlist.e2e.js` | Allowlisted writes pass and are audited; others stay blocked |
| `tests/e2e/sync.e2e.js` | Ordered queue, no skipped comparisons, de-duplication, out-of-sync + resync, Stop draining, ignore rules |
| `tests/e2e/actions.e2e.js` | Double-click, hover and keyboard capture and replay |
| `tests/e2e/capture.e2e.js`, `extract.e2e.js` | Viewport/masking/scope; in-page snapshot extraction |
| `tests/e2e/comparisons.e2e.js` | DOM, CSS, a11y, data, network and console comparisons end to end; ignore rules; budget path |
| `tests/e2e/login.e2e.js` | Auto-login, secrets never logged or recorded, wrong-key fallback |
| `tests/e2e/expected-highlight.e2e.js` | Expected differences and element highlighting |
| `tests/e2e/ai-race.e2e.js` | Background AI result merges into the stored run, runs once |
| `tests/ui/dashboard.ui.js` | Live frames, filters, evidence viewer, mark expected, history export, profile duplicate, evidence traversal and password-leak checks |

---

## Project structure

```
.
├── qa-vision/                  QA Vision dashboard + engine (Next.js 16, port 3001)
│   ├── app/page.tsx            Dashboard UI (profiles, controls, live view, timeline, findings, history)
│   ├── app/api/session/        create / pause / resync / stop / replicate
│   ├── app/api/profiles/       profile CRUD (SQLite store)
│   ├── app/api/findings, runs, evidence, report/   finding actions, run history, evidence files, report exports
│   ├── lib/playwright.ts       ★ Engine orchestrator: browsers, recorder, safety, matching, queue
│   ├── lib/engine/*.ts         Pure modules: diffs, data rules, store, secrets, AI, data sources, reports
│   ├── engine-dist/, playwright.js   Generated CommonJS build (loaded by server.js and the tests)
│   ├── server.js               Custom server: Next.js + Socket.IO
│   ├── scripts/build-engine.js Rebuilds playwright.js
│   └── tests/                  unit/, e2e/, run-e2e.js
├── sample-dev/                 Fixture DEV app (port 3002)
├── sample-prod/                Fixture PROD app (port 3003)
├── Start *.bat                 Windows launchers
└── *.md                        Specifications
```

Runtime output stays local and is git-ignored:
- `qa-vision/reports/`: evidence screenshots, session snapshots, PDFs
- `qa-vision/data/`: SQLite database (profiles, runs, findings, secrets) and key file

---

## Development notes

- **After any change to `lib/playwright.ts` or `lib/engine/**`, run `npm run build:engine`** and commit the generated `engine-dist/` and `playwright.js`. `server.js` and the tests load the compiled output, so a stale copy means stale behavior.
- Type-check with `npx tsc --noEmit -p .` (in `qa-vision/`).
- Set `QA_VISION_HEADLESS=1` to launch the comparison browsers headless (used by the tests).
- The DEV recorder is injected with Playwright's `addInitScript` and `exposeFunction`. It only sees actions in the **Playwright-managed DEV window**, not your normal browser.

---

## Known limitations

Deliberate gaps against the full specification, and known weaknesses:

- **SQLite instead of PostgreSQL as the primary store.** Profiles, runs, findings, expectations and secrets live in a local SQLite file (`node:sqlite`, hence Node 22.13+). PostgreSQL is supported only as a read-only *comparison data source*, not as the app's own storage.
- **The live view is a mirror, not an interactive embedded browser.** The dashboard shows streamed frames of both browsers; you still work in the separate DEV window. Frames stop while the run is paused.
- **No app-version capture.** There is no generic way to read an application's version, so none is recorded.
- **AI analysis and Postgres checks are not verified in CI** (see [What works today](#what-works-today)).
- **The SQL guard is a denylist, not an allowlist.** It rejects write/DDL/transaction keywords, multiple statements and dangerous functions. It also rejects quoted identifiers that equal a keyword, such as `"end"` or `"set"`. Use a read-only database role as the real protection.
- **DB connection strings are not origin-bound.** Unlike login credentials, a stored database connection string is not tied to the profile's URLs.
- **API checks are GET-only** and do not go through the PROD safety evaluator.
- **The e2e suites write run records into the default data directory** (`qa-vision/data/qa-vision.db`) unless they set a temporary `QA_VISION_DATA_DIR`. The file can grow; it is git-ignored and safe to delete.
- **Recording tradeoffs:** native buttons are not click-delayed, so a React `onDoubleClick` on a native button is not detected; Enter-to-submit can log two skipped entries. SPA route changes via `pushState` replay only through the click that caused them.
- **Text matching heuristics** in `diffPageContent` were tuned on the sample apps. Use `data-testid` attributes in both environments for the most reliable matching.
- **No dashboard authentication** and no CSRF protection beyond JSON content-type checks. Run it locally.
