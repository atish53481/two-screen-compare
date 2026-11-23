# Two Screen Compare — QA Vision

Compare two environments of the same web application (typically **DEV** vs **PROD**) by using one and watching the other follow.

You click and type in a DEV browser window. QA Vision captures each action, finds the equivalent element in PROD, replays it there **safely**, and compares both screens after every step. Differences are streamed to a dashboard and collected into a PDF report.

> **Status: working core, not feature-complete.** See [What works today](#what-works-today) and [Known limitations](#known-limitations) before relying on it. The full target specification is in [`QA_Vision_Dynamic_Two_App_Comparison_Grok.md`](QA_Vision_Dynamic_Two_App_Comparison_Grok.md) and [`Master Prompt AI-Powered DEV vs PRO.md`](Master%20Prompt%20AI-Powered%20DEV%20vs%20PRO.md).

---

## Contents

- [Quick start](#quick-start)
- [How a comparison works](#how-a-comparison-works)
- [What works today](#what-works-today)
- [PROD safety](#prod-safety)
- [Ignore rules](#ignore-rules)
- [Tests](#tests)
- [Project structure](#project-structure)
- [Development notes](#development-notes)
- [Known limitations](#known-limitations)

---

## Quick start

**Requirements:** Node.js 20+ and npm. Windows, macOS or Linux.

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

| Area | Status |
|---|---|
| Runtime-configurable DEV/PROD URL pairs, saved profiles | ✅ |
| Two isolated Playwright browsers, DEV action recorder | ✅ click, input, change, select, back/forward |
| Element matching on PROD | ✅ test id → id → role + name → label → name → placeholder → aria-label → input type. Used **only when exactly one element matches**; ambiguous or missing matches are reported, never guessed |
| PROD safety (read-only default, network write guard, allowlist) | ✅ [details](#prod-safety) |
| Ordered replay queue; every step covered by a comparison | ✅ |
| Text comparison + pixel diff (pixelmatch) + side-by-side evidence (sharp) | ✅ |
| Finding de-duplication with occurrence counts and step references | ✅ |
| Ignore rules (normalize / exclude), suppression counts logged | ✅ [details](#ignore-rules) |
| Out-of-sync detection, real Resync, closed-window detection | ✅ |
| Live log + findings over Socket.IO | ✅ |
| PDF report from the full server-side run | ✅ |
| Password / secret-field redaction in all evidence | ✅ |
| Unit + end-to-end tests | ✅ [details](#tests) |

Every finding has a `classification`: `UNMAPPED_OR_MISSING_FEATURE`, `REPLAY_FAILURE`, `SKIPPED_BY_SAFETY_POLICY` or `NOT_COMPARABLE`. Content differences carry no classification yet.

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

## Tests

Run from `qa-vision/` (or `npm test` at the repo root):

```bash
npm run test:unit   # pure helpers (URL validation, URL mapping, ignore rules), no browsers
npm run test:e2e    # real headless Chromium against the sample apps
npm test            # both
```

`test:e2e` starts the sample apps if they aren't running and stops them afterwards. Run a single suite with `npm run test:e2e -- safety`. To point the suites at other deployments, set `QA_DEV_URL` and `QA_PROD_URL`.

| Suite | Covers |
|---|---|
| `tests/unit/engine-utils.test.js` | URL validation, DEV→PROD URL mapping, ignore-rule normalization/exclusion |
| `tests/e2e/safety.e2e.js` | Read-only default; destructive/submit blocking; network write guard; ambiguous & missing element handling; navigation mapping; password redaction; URL rejection |
| `tests/e2e/allowlist.e2e.js` | Allowlisted writes pass and are audited; others stay blocked |
| `tests/e2e/sync.e2e.js` | Ordered queue, no skipped comparisons, de-duplication, out-of-sync + resync, Stop draining, ignore rules |

---

## Project structure

```
.
├── qa-vision/                  QA Vision dashboard + engine (Next.js 16, port 3001)
│   ├── app/page.tsx            Dashboard UI (profiles, controls, live log, findings, report export)
│   ├── app/api/session/        create / pause / resync / stop / replicate
│   ├── app/api/profiles/       profile CRUD (stored in qa-vision/data/profiles.json)
│   ├── app/api/report/         PDF report generation
│   ├── lib/playwright.ts       ★ Engine: browsers, recorder, safety, matching, queue, comparison
│   ├── lib/report-generator.ts PDF builder (pdf-lib)
│   ├── playwright.js           Generated CommonJS copy of the engine (loaded by server.js)
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
- `qa-vision/data/`: saved profiles

---

## Development notes

- **After any change to `lib/playwright.ts`, run `npm run build:engine`.** `server.js` loads the compiled `playwright.js`, not the TypeScript, so a stale copy means stale behavior.
- Type-check with `npx tsc --noEmit -p .` (in `qa-vision/`).
- Set `QA_VISION_HEADLESS=1` to launch the comparison browsers headless (used by the tests).
- The DEV recorder is injected with Playwright's `addInitScript` and `exposeFunction`. It only sees actions in the **Playwright-managed DEV window**, not your normal browser.

---

## Known limitations

These are planned and **not implemented yet**:

- **Comparison depth:**
  - No computed-CSS comparison
  - No DOM-structure comparison
  - No network/API or console-error capture
  - No accessibility checks
  - No configurable data-comparison rules (numeric tolerance etc.)
- **Recording:** hover, double-click and keyboard shortcuts are not captured. SPA route changes via `pushState` are not replayed directly; they replay through the click that caused them.
- **Dashboard:**
  - The "live dual view" panels are placeholders; the real browsers are separate windows.
  - Clicking a finding does not highlight the element in the browsers.
  - Findings can't be marked as expected differences.
- **No AI analysis.** The `aiAnalysis` field is not produced by a model.
- **Storage:** no database. Profiles live in a JSON file, and the current/last run is kept in memory and in `reports/evidence/<session>/session-snapshot.json`.
- **Reports:** PDF only, no HTML / Excel / JSON export from the UI.
- **Text matching heuristics** in `diffPageContent` were tuned on the sample apps. Use `data-testid` attributes in both environments for the most reliable matching.
