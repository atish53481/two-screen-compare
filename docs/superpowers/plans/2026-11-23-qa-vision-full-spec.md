# QA Vision — Full Spec Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap between the working QA Vision core and the two specs: DOM, CSS, layout, accessibility, data, network and console comparison; AI analysis; persistent storage and history; an encrypted secret store with auto-login; expected-difference marking; highlighting findings in the browsers; richer action capture; configurable capture settings; HTML/JSON/Excel/CSV reports; and a live dual view.

**Architecture:** New comparison logic lives in small **pure** modules under `qa-vision/lib/engine/`. They take plain-JSON snapshots and return `FindingDraft[]`, so they can be unit-tested without a browser. `lib/playwright.ts` stays the orchestrator: it extracts snapshots in the page, calls the pure diffs and records findings. The engine build changes from "copy one file" to "emit a directory": `qa-vision/engine-dist/` plus a one-line `playwright.js` shim, so `server.js` and the existing tests keep working. Storage is SQLite through Node's built-in `node:sqlite`, behind a `Store` interface.

**Tech Stack:** Next.js 16, React 19, TypeScript, Playwright 1.65, pixelmatch, sharp, Socket.IO, pdf-lib, exceljs (already installed), `node:sqlite` (Node ≥ 22.13), `@anthropic-ai/sdk` (new), `pg` (new, optional DB checks).

**Spec:** `QA_Vision_Dynamic_Two_App_Comparison_Grok.md` (primary) and `Master Prompt AI-Powered DEV vs PRO.md` (repo root). Executors read both.

## Global Constraints

- "PROD must be **read-only by default**." Nothing in this plan may weaken `evaluateAction` / `installProdNetworkGuard`. Every new PROD action type goes through `evaluateAction`.
- "**no localhost URL or sample app is hardcoded into comparison logic**". Sample-app knowledge belongs only in `sample-*` and tests.
- "CSS class-name differences alone are not defects." Never diff `class`.
- "**AI can propose a classification, but should not silently suppress differences or declare every difference a defect.**" AI output is advisory and stored in `finding.ai`. It never changes `classification`.
- "AI failure does not prevent deterministic comparisons or reports."
- "Never put secrets in profile JSON or browser console logs." "Sanitize screenshots, traces, logs, API data, and prompts before sending them to Grok or any external LLM." "never expose keys in frontend code."
- AI "must not automatically modify or deploy application code" and "must distinguish observed facts from hypotheses."
- Classifications (exact strings): `MATCH`, `EXPECTED_DIFFERENCE`, `POTENTIAL_DEFECT`, `REPLAY_FAILURE`, `NOT_COMPARABLE`, `SKIPPED_BY_SAFETY_POLICY`, plus the existing `UNMAPPED_OR_MISSING_FEATURE`.
- "If an action cannot be replicated, report it instead of silently skipping it."
- After every change to `lib/playwright.ts` or `lib/engine/**`, run `npm run build:engine` and commit the `engine-dist/` output with the source.
- Node floor rises from 20 to **22.13**, because of `node:sqlite`. Document this in the README.
- Deviation from spec, recorded on purpose: storage is SQLite, not PostgreSQL, so local use needs no database server. The `Store` interface is the seam for a Postgres adapter later.

## Review Focus

1. **Huge pages** (thousands of nodes, long tables). Extraction is capped at 400 elements and 50 table rows, and one comparison must finish within its time budget instead of stalling the queue. Pinned by the Task 3 test `extraction caps elements on a 5,000-node page`.
2. **Secrets leaking through new channels.** Password values must not appear in network evidence, stored findings, AI prompts or reports. Pinned by Task 8 `network capture never stores bodies or query values`, Task 11 `auto-login never logs or stores the password`, and Task 14 `redactForAi strips sensitive values`.
3. **AI unreachable, no key, or timeout.** The run completes, findings are unchanged, and `ai.status` is `unavailable` or `error`. Pinned by Task 14 `provider timeout leaves findings intact`.
4. **Secret key lost or changed after a restart.** Stored credentials can't be decrypted: show a clear message asking the user to re-enter them, don't crash, and fall back to manual login. Pinned by Task 11 `decrypt with wrong key throws SecretError and login falls back to manual`.
5. **Element on one side only, hidden, or inside a cross-origin iframe.** It is reported once, as a DOM missing/extra finding, never as a CSS crash, and is skipped silently during extraction. Pinned by Task 5 `css diff ignores unpaired elements` and Task 3 `extraction skips cross-origin iframes`.

---

## File Structure

```
qa-vision/
├── lib/engine/                 NEW: pure, unit-tested modules
│   ├── types.ts                shared types: ElementSnapshot, TableSnapshot, NetworkEntry, RuntimeEvent, FindingDraft, Finding, Classification, Category, CaptureSettings, DataRule
│   ├── findings.ts             fingerprint(), classifyFinding(), normalizeCaptureSettings()
│   ├── extract.ts              in-page extraction functions (passed to page.evaluate)
│   ├── dom-diff.ts             structure, attribute, visibility, enabled, form-constraint and order diffs
│   ├── css-diff.ts             computed-style and layout-box diffs
│   ├── a11y-diff.ts            accessibility diffs
│   ├── data-rules.ts           value comparison modes and table diffs
│   ├── runtime-diff.ts         network/API and console/page-error diffs
│   ├── secrets.ts              AES-256-GCM secret encryption
│   ├── store.ts                node:sqlite Store (profiles, runs, findings, expectations, secrets)
│   ├── ai.ts                   provider interface, redaction, analyzeFindings
│   ├── data-sources.ts         API endpoint checks and read-only Postgres checks
│   └── reports/{model,html,json,xlsx,csv}.ts
├── lib/playwright.ts           MODIFY: orchestrates everything above
├── lib/profile-manager.ts      MODIFY: backed by Store and secrets
├── lib/types.ts                MODIFY: ComparisonProfile gains settings
├── engine-dist/                NEW (generated, committed): compiled engine tree
├── playwright.js               becomes a shim: module.exports = require('./engine-dist/playwright.js')
├── scripts/build-engine.js     MODIFY: emits the whole tree
├── app/api/{session,profiles,report}/route.ts   MODIFY
├── app/api/{runs,findings,evidence}/route.ts    NEW
├── app/components/             NEW: FindingsPanel, EvidenceViewer, Timeline, LiveView, HistoryTab, ProfileSettings
└── tests/unit/*.test.js, tests/e2e/*.e2e.js, tests/ui/dashboard.ui.js
sample-dev/, sample-prod/       MODIFY: deliberate CSS/DOM/a11y/API/console differences (fixtures)
```

---

### Task 1: Multi-file engine build + finding model

**Files:**
- Create: `qa-vision/lib/engine/types.ts`, `qa-vision/lib/engine/findings.ts`, `qa-vision/tests/unit/findings.test.js`
- Modify: `qa-vision/scripts/build-engine.js`, `qa-vision/playwright.js` (shim), `qa-vision/lib/playwright.ts:1583-1637` (fingerprint/recordMismatch), `qa-vision/lib/playwright.ts:1240-1278` (remove template `aiAnalysis`), `qa-vision/package.json` (`engines.node: ">=22.13"`)

**Interfaces:**
- Produces in `types.ts`:
  - `type Classification = 'MATCH'|'EXPECTED_DIFFERENCE'|'POTENTIAL_DEFECT'|'REPLAY_FAILURE'|'NOT_COMPARABLE'|'SKIPPED_BY_SAFETY_POLICY'|'UNMAPPED_OR_MISSING_FEATURE'`
  - `type Category = 'Text'|'Visual'|'DOM'|'CSS'|'Layout'|'Accessibility'|'Data'|'Network'|'Console'|'Interaction'|'Safety'|'Navigation'`
  - `type Severity = 'low'|'medium'|'high'|'critical'`
  - `interface FindingDraft { type: Category; component: string; devValue: string; prodValue: string; severity: Severity; description: string; classification?: Classification; confidence?: number; property?: string; devSelector?: string; prodSelector?: string; ruleApplied?: string|null }`
  - `interface Finding extends FindingDraft { id; timestamp; firstSeen; lastSeen; occurrences; page; fingerprint; stepIds?: string[]; classification: Classification; confidence: number; ai?: AiAnalysis; devScreenshotPath?; prodScreenshotPath?; diffScreenshotPath?; diffPercent? }` (`AiAnalysis` declared here and filled in Task 14)
- Produces in `findings.ts`:
  - `fingerprint(page: string, f: FindingDraft & {diffPercent?: number}): string`: the existing algorithm, moved unchanged, plus `property` appended when present
  - `classifyFinding(f: FindingDraft, expectedFingerprints: Set<string>, fp: string): {classification: Classification; confidence: number; ruleApplied: string|null}`. Rules: an explicit `f.classification` is kept (confidence 1). `fp` in the set gives `EXPECTED_DIFFERENCE` with `ruleApplied: 'expected:'+fp`. Otherwise `POTENTIAL_DEFECT`, with confidence 0.9 for Text/DOM/Data/Network/Console, 0.75 for CSS/Layout/Accessibility, and 0.6 for Visual.

- [ ] **Step 1: Branch.** `git checkout -b feat/full-spec`
- [ ] **Step 2: Write failing test** `tests/unit/findings.test.js`:

```js
const { fingerprint, classifyFinding } = require('../../engine-dist/engine/findings.js');
test('explicit classification wins', () => {
  assert.deepEqual(classifyFinding({ type: 'Safety', classification: 'SKIPPED_BY_SAFETY_POLICY' }, new Set(), 'x'),
    { classification: 'SKIPPED_BY_SAFETY_POLICY', confidence: 1, ruleApplied: null });
});
test('expected fingerprint marks EXPECTED_DIFFERENCE with provenance', () => {
  const r = classifyFinding({ type: 'Text' }, new Set(['fp1']), 'fp1');
  assert.equal(r.classification, 'EXPECTED_DIFFERENCE'); assert.equal(r.ruleApplied, 'expected:fp1');
});
test('content difference defaults to POTENTIAL_DEFECT', () => {
  assert.equal(classifyFinding({ type: 'CSS' }, new Set(), 'z').classification, 'POTENTIAL_DEFECT');
});
test('fingerprint is stable and includes property', () => {
  const a = fingerprint('/', { type: 'CSS', component: 'btn', devValue: 'red', prodValue: 'blue', property: 'color' });
  assert.equal(a, fingerprint('/', { type: 'CSS', component: 'btn', devValue: 'red', prodValue: 'blue', property: 'color' }));
  assert.notEqual(a, fingerprint('/', { type: 'CSS', component: 'btn', devValue: 'red', prodValue: 'blue', property: 'background-color' }));
});
```

- [ ] **Step 3: Change `build-engine.js`.** Compile `lib/playwright.ts` plus every `lib/engine/**/*.ts` (pass the expanded file list) with `--rootDir lib --outDir engine-dist`, keeping the existing flags. Delete `engine-dist` before each build. Write `playwright.js` as `module.exports = require('./engine-dist/playwright.js');\n`.
- [ ] **Step 4: Implement `types.ts` and `findings.ts`.** Make `recordMismatch` call `fingerprint` and `classifyFinding`, using `session.expected` (`Set<string>`, empty for now, filled in Task 13). Store `fingerprint`, `classification`, `confidence` and `ruleApplied` on each finding. In `diffPageContent`, drop the `aiAnalysis` template strings and fold the "DEV shows exactly / PROD shows exactly" wording into `description`.
- [ ] **Step 5: Verify.** `npm run build:engine && npm run test:unit && npm run test:e2e`. Expected: all unit tests pass, `✔ All 3 e2e suites passed`.
- [ ] **Step 6: Commit** `feat(engine): multi-file engine build and classified finding model`

---

### Task 2: Configurable capture settings

**Files:**
- Modify: `qa-vision/lib/types.ts` (profile), `qa-vision/lib/playwright.ts:270-433` (createSession), `:1302-1475` (screenshot/threshold), `qa-vision/app/api/session/route.ts`, `qa-vision/tests/e2e/*.e2e.js` call sites
- Test: `qa-vision/tests/unit/capture-settings.test.js`, `qa-vision/tests/e2e/capture.e2e.js`

**Interfaces:**
- Produces in `engine/types.ts`: `interface CaptureSettings { viewport: {width:number;height:number}; pixelThreshold: number /*pixelmatch 0..1, default 0.1*/; visualDiffRatio: number /*finding threshold, default 0.02*/; fullPage: boolean /*default false*/; maskSelectors: string[]; scopeSelector: string /*'' = whole page*/; settleMs: number /*default 350*/; layoutTolerancePx: number /*default 2*/ }`. The viewport defaults to 1280×800.
- Produces in `findings.ts`: `normalizeCaptureSettings(input: Partial<CaptureSettings>|undefined): CaptureSettings`. It clamps the viewport to 320–3840 × 320–2160, thresholds to 0–1, `settleMs` to 0–10000 and `layoutTolerancePx` to 0–50, and drops empty selectors.
- Produces in `playwright.ts`: `interface SessionOptions { projectName; safetyPolicy; safetyAllowlist; ignoreRules; capture?: Partial<CaptureSettings>; profileId?: string; login?: LoginConfig; dataRules?: DataRule[]; apiChecks?: ApiCheck[]; dbChecks?: DbCheck[] }`. `createSession(devUrl, prodUrl, opts: SessionOptions)` replaces the positional parameters, and `startSessionWithRecorder` follows. The `LoginConfig`, `DataRule`, `ApiCheck` and `DbCheck` types are declared optional now and defined in Tasks 7, 11 and 17.

- [ ] **Step 1: Failing unit test.** `normalizeCaptureSettings({viewport:{width:10,height:99999}, pixelThreshold: 5})` must return `viewport {width:320,height:2160}` and `pixelThreshold 1`. `normalizeCaptureSettings(undefined)` must deep-equal the documented defaults.
- [ ] **Step 2: Failing e2e** `capture.e2e.js`. Start a session with `capture:{viewport:{width:800,height:600}, maskSelectors:['[data-testid="login-email"]']}`, then check that `session.devPage.viewportSize()` is `{width:800,height:600}` and that the first evidence PNG is 800 px wide (read with `pngjs`).
- [ ] **Step 3: Implement.** Both contexts use `capture.viewport`. Screenshots pass `fullPage` and `mask: maskSelectors.map(s => page.locator(s))`. When `scopeSelector` is set, screenshot that locator, and extraction (Task 3) gets the scope root. If the scope element is missing on either side, record a `NOT_COMPARABLE` finding. `pixelmatch` uses `pixelThreshold`, and the visual finding uses `visualDiffRatio`. `waitForSettled` uses `settleMs`. The session route accepts `capture`.
- [ ] **Step 4: Verify.** `npm run build:engine && npm run test:unit && npm run test:e2e`
- [ ] **Step 5: Commit** `feat(engine): configurable viewport, thresholds, masking and comparison scope`

---

### Task 3: In-page element, table and accessibility extraction

**Files:** Create `qa-vision/lib/engine/extract.ts`. Test `qa-vision/tests/e2e/extract.e2e.js` (uses `page.setContent`, so no sample apps are needed)

**Interfaces:**
- Produces in `types.ts`:
  - `interface ElementSnapshot { key: string; selector: string; path: string; tag: string; testId: string; elementId: string; role: string; name: string; text: string; visible: boolean; enabled: boolean; box: {x:number;y:number;w:number;h:number}; styles: Record<string,string>; attrs: Record<string,string>; a11y: {label: string; alt: string|null; ariaHidden: boolean; tabIndex: number; focusable: boolean}; order: number }`
  - `interface TableSnapshot { key: string; selector: string; headers: string[]; rows: string[][]; rowCount: number }`
  - `interface PageSnapshot { url: string; elements: ElementSnapshot[]; tables: TableSnapshot[]; truncated: boolean }`
- Produces in `extract.ts`:
  - `STYLE_PROPS: readonly string[]`, exactly: `font-family, font-size, font-weight, line-height, letter-spacing, text-align, text-decoration-line, color, background-color, border-top-color, border-top-width, border-top-style, border-radius, box-shadow, opacity, display, visibility, position, overflow, z-index, padding-top, padding-right, padding-bottom, padding-left, margin-top, margin-right, margin-bottom, margin-left, flex-direction, justify-content, align-items, gap, grid-template-columns`
  - `ATTR_ALLOWLIST: readonly string[]`, exactly: `type, href, required, maxlength, minlength, min, max, pattern, placeholder, disabled, readonly, checked, aria-expanded, aria-selected, aria-checked, aria-disabled, aria-invalid, aria-required, aria-describedby, role, alt, target`. `href` keeps the path only, with no origin or query.
  - `extractPageSnapshot(arg: {scopeSelector: string; maxElements: number /*400*/; maxRows: number /*50*/; sensitiveSource: string; styleProps: string[]; attrAllowlist: string[]}): PageSnapshot`. Self-contained, to pass into `page.evaluate`: no closures and no imports.
  - Key rule: `testId ? 'tid:'+testId : elementId ? 'id:'+elementId : (role && name) ? 'rn:'+role+'|'+name : 'path:'+path`, where `path` is a tag chain of up to 6 ancestors with `:nth-of-type`.
  - `selector` is the first unique selector among `[data-testid="…"]`, `#id` and `path`.
  - Element priority until the cap: `[data-testid]`, then interactive elements (`a,button,input,select,textarea,[role],[tabindex]`), then `h1-h6,label,img,th,td,li,p`, then everything else. Set `truncated=true` when the cap is hit.
  - Sensitive field values are read as `'[redacted]'`, using the same rule as `extractPageContent`.

- [ ] **Step 1: Failing e2e tests** (headless chromium with `setContent`):
  - `extraction returns styles, box and a11y for a button`: `<button data-testid="b" style="color: rgb(255, 0, 0)">Go</button>` produces key `tid:b`, `styles.color` `rgb(255, 0, 0)`, `role` `button`, `name` `Go`, and `box.w > 0`.
  - `extraction caps elements on a 5,000-node page`: gives `elements.length <= 400`, `truncated === true`, and the evaluate call finishes in under 3000 ms.
  - `extraction skips cross-origin iframes`: `<iframe src="https://example.com">` doesn't throw.
  - `password values are redacted`: `<input type=password value="hunter2">` yields `text` without `hunter2`.
  - `table snapshot`: a 3-row table gives `headers`, `rowCount 3` and the cell text.
- [ ] **Step 2: Run** `node tests/e2e/extract.e2e.js`. Expected: FAIL (undefined).
- [ ] **Step 3: Implement.** Accessible name is `aria-label`, then the `aria-labelledby` text, then `labels[0]`, then `alt`, then `title`, then `innerText`, trimmed to 80 characters. `visible` means `checkVisibility()` is true and the box has nonzero area. `enabled` means not `:disabled` and `aria-disabled` is not `"true"`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): structured in-page snapshot extraction`

---

### Task 4: DOM structure diff (includes form constraints)

**Files:** Create `qa-vision/lib/engine/dom-diff.ts`. Test `qa-vision/tests/unit/dom-diff.test.js`

**Interfaces:**
- Produces: `pairElements(dev, prod): {pairs: Array<[ElementSnapshot, ElementSnapshot]>; devOnly: ElementSnapshot[]; prodOnly: ElementSnapshot[]}`, pairing by `key` (duplicate keys pair in `order`), which Tasks 5–7 reuse. Also `diffDom(dev: ElementSnapshot[], prod: ElementSnapshot[]): FindingDraft[]`, with every finding `type:'DOM'` and carrying `devSelector`/`prodSelector`.

| Condition | property | severity |
|---|---|---|
| devOnly, visible | `presence` (prod "(missing on PROD)") | `high` if interactive or testId, else `medium` |
| prodOnly, visible | `presence` (dev "(missing on DEV)") | `medium` |
| tag differs | `tag` | `medium` |
| visible differs | `visibility` | `high` |
| enabled differs | `enabled` | `high` |
| allowlisted attr differs | `attr:<name>` | `medium` (`high` for `type`, `required`, `disabled`) |
| relative order of paired keys changed (keys outside the LCS, max 10) | `order` | `low` |

`component` is the element name, or else its key. Elements invisible on both sides are never reported.

- [ ] **Step 1: Failing tests**, using an `el(key, over)` factory:
  - `missing interactive element is high`
  - `disabled on PROD only is reported`: devValue `'enabled'`, prodValue `'disabled'`
  - `required attr removed is high`
  - `class attribute never compared`
  - `hidden on both sides not reported`
  - `order change reported low`
- [ ] **Steps 2–4:** `npm run build:engine && node --test tests/unit/dom-diff.test.js` → FAIL, implement, rerun → PASS.
- [ ] **Step 5: Commit** `feat(engine): DOM structure and form-constraint diff`

---

### Task 5: Computed-CSS and layout diff

**Files:** Create `qa-vision/lib/engine/css-diff.ts`. Test `qa-vision/tests/unit/css-diff.test.js`

**Interfaces:**
- Produces: `diffCss(pairs, opts:{layoutTolerancePx:number}): FindingDraft[]`
  - Compares only pairs visible on both sides. Each differing `STYLE_PROPS` entry gives `type:'CSS'` with `property` set to the CSS property name.
  - Severity: `medium` for `color, background-color, font-family, font-size, font-weight, display, visibility, opacity`; `low` otherwise.
  - Values are compared after whitespace normalization. `rgba(r, g, b, 1)` equals `rgb(r, g, b)`.
  - Layout: a `type:'Layout'` finding per box field `x|y|w|h` whose |Δ| exceeds the tolerance, with `property 'box.w'` etc. Severity is `medium` when Δ > 20 px, else `low`. Values are formatted like `"120px"`.
  - Cap: at most 8 CSS findings and 4 layout findings per element.

- [ ] **Step 1: Failing tests:**
  - `background color difference is medium`: `rgb(16, 185, 129)` vs `rgb(37, 99, 235)`
  - `rgba alpha 1 equals rgb`
  - `width delta within tolerance ignored, beyond reported`: 120 vs 121 at tolerance 2 gives `[]`; 120 vs 150 gives `box.w`, `medium`, `"120px"`
  - `css diff ignores unpaired elements`
  - `per-element cap`
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(engine): computed CSS and layout comparison`

---

### Task 6: Accessibility diff

**Files:** Create `qa-vision/lib/engine/a11y-diff.ts`. Test `qa-vision/tests/unit/a11y-diff.test.js`

**Interfaces:** `diffA11y(pairs): FindingDraft[]`, with `type:'Accessibility'`. Checks per pair:
- `role` (`medium`)
- accessible `name` (`medium`)
- `a11y.label` on form fields (`high` when one side is empty)
- `img` `alt` missing on one side only (`high`)
- `ariaHidden` (`medium`), `focusable` (`medium`), and `tabIndex` sign change (`low`)

- [ ] **Step 1: Failing tests:** `img alt missing on DEV only is high`, `input label lost is high`, `focusable change reported`, `identical a11y gives no findings`.
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(engine): accessibility comparison`

---

### Task 7: Data comparison rules and tables

**Files:** Create `qa-vision/lib/engine/data-rules.ts`. Test `qa-vision/tests/unit/data-rules.test.js`

**Interfaces:**
- `types.ts`: `interface DataRule { target: string /* element key e.g. "tid:stat-active-users", or "table:<key>:<header|*>" */; mode: 'exact'|'numeric'|'tolerance'|'percent'|'date'|'case-insensitive'|'null-equals-empty'|'ignore'; tolerance?: number; expect?: 'equal'|'different' /* default equal */ }`
- `parseNumber(s: string): number|null`. Handles `$1,250.50` → 1250.5, `1.2M` → 1200000, `3k` → 3000, `(42)` → -42 and `12%` → 12; anything else gives `null`.
- `compareValues(dev: string, prod: string, rule: DataRule): {match: boolean; detail: string}`. In `date` mode both sides go through `Date.parse` and are compared by calendar day. `expect:'different'` inverts the match.
- `diffData(pairs, tablesDev: TableSnapshot[], tablesProd: TableSnapshot[], rules: DataRule[]): FindingDraft[]`, with `type:'Data'` and `ruleApplied` set to `<target>/<mode>`. Only targets that have a rule are compared; the text diff still covers everything else. Tables: a row-count difference is `high`; cell differences are compared per header under that header's rule and capped at 20.

- [ ] **Step 1: Failing tests:**
  - `parseNumber` cases above
  - `tolerance: 1250 vs 1248 tol 5 matches; tol 1 mismatches with detail "Δ 2 > 1"`
  - `percent: 100 vs 103 tol 5 matches`
  - `case-insensitive`
  - `null-equals-empty ("", "null", "—" equal)`
  - `date ("2026-11-23" vs "Nov 23, 2026" match)`
  - `table row count difference is high`
  - `rule ignore produces nothing`
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(engine): configurable data comparison rules and table diff`

---

### Task 8: Network/API and console capture

**Files:** Create `qa-vision/lib/engine/runtime-diff.ts`. Modify `qa-vision/lib/playwright.ts` (collectors attached in `createSession`). Test `qa-vision/tests/unit/runtime-diff.test.js`

**Interfaces:**
- `types.ts`:
  - `interface NetworkEntry { method: string; path: string /* origin stripped; query reduced to sorted keys "?a&b" */; status: number|null; resourceType: string; contentType: string; schema: string[]|null /* sorted JSON key paths, depth ≤ 2, json responses ≤ 256 KB */; failure: string|null }`
  - `interface RuntimeEvent { kind: 'console-error'|'page-error'|'request-failed'; text: string /* ≤ 300 chars, sensitive values redacted */ }`
- `toNetworkPath(url: string): string`
- `schemaOf(json: unknown, depth = 2): string[]`
- `diffNetwork(dev: NetworkEntry[], prod: NetworkEntry[]): FindingDraft[]`
  - Only `xhr`/`fetch`/`document` entries count, matched by `method+path`. All findings are `type:'Network'`.
  - A status difference is `high` when either side is ≥ 400, else `medium`. A schema difference is `medium`. A request only on one side is `medium`.
  - Entries with failure `net::ERR_BLOCKED_BY_CLIENT` (the PROD guard) are skipped, because Safety findings cover them.
- `diffRuntime(dev: RuntimeEvent[], prod: RuntimeEvent[]): FindingDraft[]`. Events present on one side only, matched by normalized text (digits → `<N>`), give `type:'Console'`, `high` for `page-error` and `medium` otherwise.
- `playwright.ts`: `session.netLog = {dev: NetworkEntry[], prod: NetworkEntry[]}` and `session.runtimeLog = {dev: RuntimeEvent[], prod: RuntimeEvent[]}` are filled by `page.on('response'|'requestfailed'|'console'|'pageerror')` and spliced empty by every comparison. Bodies are read only to compute `schema`, and values are never stored.

- [ ] **Step 1: Failing tests:**
  - `toNetworkPath("https://x.com/api/u?id=5&token=abc#h") === "/api/u?id&token"`
  - `schemaOf({a:1,b:{c:2,d:[{e:1}]}})` deep-equals `["a","b","b.c","b.d"]`
  - `status 200 vs 500 is high`, `schema key missing is medium`, `blocked PROD request ignored`
  - `console error only on PROD reported; same error both sides not reported`
  - `network capture never stores bodies or query values`: a captured entry for `?password=hunter2` doesn't stringify to anything containing `hunter2`
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(engine): network/API and console/page-error comparison`

---

### Task 9: Wire all comparisons into each step + fixtures + e2e

**Files:**
- Modify: `qa-vision/lib/playwright.ts:1302-1416` (compareAfterAction), `sample-dev/app/page.tsx`, `sample-prod/app/page.tsx`
- Create: `sample-dev/app/api/stats/route.ts`, `sample-prod/app/api/stats/route.ts`, `qa-vision/tests/e2e/comparisons.e2e.js`

**Interfaces:**
- `compareAfterAction` extracts a `PageSnapshot` on both pages in parallel and runs `diffDom`, `diffCss`, `diffA11y`, `diffData(session.dataRules)`, `diffNetwork` and `diffRuntime`. Each draft goes through the ignore rules (like text diffs today) and then `recordMismatch`.
- Time budget: when extraction plus diffs exceed `15000 ms`, log `Comparison budget exceeded` and keep only the text and visual findings.
- Log line: `Compared after …: N new (Text a, DOM b, CSS c, Layout d, A11y e, Data f, Network g, Console h)`.
- Fixture differences, DEV vs PROD, each with a `// deliberate fixture difference` comment:
  - `data-testid="stat-active-users"` `1,250` vs `1,248`
  - `btn-add-user` padding `px-6` vs `px-4`
  - `<img data-testid="logo">` with `alt="Acme"` on PROD only
  - the dashboard fetches `/api/stats`: DEV returns `{users, revenue, growth}`, PROD `{users, revenue}`
  - PROD logs `console.error('Legacy chart failed to load')` on the dashboard
  - `data-testid="orders"` table with 3 rows on DEV, 2 on PROD

- [ ] **Step 1: Add fixtures.** Check them with `curl http://localhost:3002/api/stats` and `curl http://localhost:3003/api/stats`; the key sets differ in `growth`.
- [ ] **Step 2: Failing e2e** `comparisons.e2e.js`. Log in on DEV with the profile allowlist `login-submit`, click `btn-continue-dashboard`, `idle`, then assert `session.mismatches` contains:
  - CSS or Layout on `btn-add-user`
  - Accessibility with property `alt`
  - Network mentioning `/api/stats` and `growth`
  - Console mentioning `Legacy chart`
  - Data row count on `orders`, with rule `{target:'table:tid:orders:*', mode:'exact'}`
  - DOM `enabled` on `btn-add-user`
  - each of the above classified `POTENTIAL_DEFECT`
  - no finding with `property === 'class'`
- [ ] **Step 3: Run** `npm run test:e2e -- comparisons`. Expected: FAIL.
- [ ] **Step 4: Implement the wiring.**
- [ ] **Step 5: Run the full suite.** `npm run build:engine && npm run test:unit && npm run test:e2e`. Expected: all suites pass, including the old ones.
- [ ] **Step 6: Commit** `feat(engine): run DOM/CSS/layout/a11y/data/network/console comparisons on every step`

---

### Task 10: Double-click, hover and keyboard capture and replay

**Files:** Modify `qa-vision/lib/playwright.ts:517-688` (recorder), `:812-919` (replicateAction) and `:945-971` (evaluateAction). Add sample fixtures `data-testid="row-dbl"` (a double-click opens a details panel) and `data-testid="help-hover"` (a tooltip on hover). Test `qa-vision/tests/e2e/actions.e2e.js`

**Interfaces:**
- Recorder emits:
  - `{type:'dblclick', …describe(el)}`. Plain clicks on elements that have a dblclick handler are delayed 250 ms and dropped if a dblclick follows, so they aren't replayed twice.
  - `{type:'hover', …}` after a dwell of ≥ 600 ms on an interactive element or `[title]`/`[aria-describedby]`, at most once per element per 2 s.
  - `{type:'key', key, ctrl, alt, shift, meta, …describe(document.activeElement)}` for `Enter, Escape, Tab, Arrow*, PageUp/PageDown, Home, End`, and any key pressed with a modifier. Never for unmodified printable keys (typing stays `fill`).
- Replay: `locator.dblclick`, `locator.hover`, and `locator.press(combo)`, falling back to `page.keyboard.press(combo)`.
- Safety: `evaluateAction` treats `dblclick` like `click`. `key` `Enter` inside a `<form>` counts as `isSubmit`. `hover` and other keys are non-mutating.

- [ ] **Step 1: Failing e2e:**
  - `dblclick replays and opens PROD details panel`
  - `hover replays and shows PROD tooltip`
  - `Escape key replays and closes PROD modal`
  - `Enter inside login form is blocked on PROD in read-only and recorded SKIPPED_BY_SAFETY_POLICY`
  - `single click not replayed twice around a dblclick`
- [ ] **Steps 2–4:** FAIL → implement → `npm run build:engine && npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(recorder): capture and replay double-click, hover and keyboard actions`

---

### Task 11: Encrypted secret store + auto-login

**Files:** Create `qa-vision/lib/engine/secrets.ts`. Modify `qa-vision/lib/types.ts` and `qa-vision/lib/playwright.ts`. Test `qa-vision/tests/unit/secrets.test.js`, `qa-vision/tests/e2e/login.e2e.js`

**Interfaces:**
- `class SecretError extends Error {}`
- `loadKey(env: NodeJS.ProcessEnv, dataDir: string): Buffer`. Uses `QA_VISION_SECRET_KEY` (base64 that must decode to 32 bytes, else `SecretError`). Otherwise it reads or creates `dataDir/.secret-key`: 32 random bytes, mode `0o600`, and logs once: `Generated local secret key at data/.secret-key — set QA_VISION_SECRET_KEY to manage it yourself`.
- `encryptSecret(plain: string, key: Buffer): string` returns `v1:<iv b64>:<tag b64>:<ct b64>` (AES-256-GCM, 12-byte IV).
- `decryptSecret(blob: string, key: Buffer): string`. Throws `SecretError('Stored secret cannot be decrypted — re-enter it in the profile')`.
- `types.ts`: `credentialsA?: {username: string; secretRef?: string}` (same for B), with the plaintext `password` removed. `interface LoginConfig { strategy: 'manual'|'form'; loginPath: string; usernameSelector: string; passwordSelector: string; submitSelector: string; successSelector?: string; timeoutMs?: number /*15000*/ }`
- `private async performLogin(sessionId, side: 'DEV'|'PROD', creds: {username:string; password:string}|null, cfg: LoginConfig): Promise<boolean>`
  - While `session.suppressCapture` is true, the recorder bridge drops events.
  - PROD submit runs with `permitMutationsUntil = now + 5000` and logs `PROD login submitted (profile login flow)`.
  - It logs only `Logged in on <side> as <username>` or `Login on <side> failed: <reason>`, never the password.
  - On a missing secret or a `SecretError`, it logs `Auto-login unavailable on <side>: <message> — log in manually in the window` and returns false.
- Secrets are resolved server-side only: the session route loads the profile by `profileId` and decrypts there. Passwords never travel to the client after saving.

- [ ] **Step 1: Failing unit tests:**
  - `round trip`
  - `ciphertext differs each time`
  - `decrypt with wrong key throws SecretError and login falls back to manual`: the unit part asserts that `decryptSecret` throws `SecretError`
  - `bad QA_VISION_SECRET_KEY length throws`
  - `generated key file is reused on second call`
- [ ] **Step 2: Failing e2e** `login.e2e.js`. Use the form login on the sample apps' `login-email` / `login-password` / `login-submit`, with success `btn-continue-dashboard`:
  - both pages show the success element
  - `auto-login never logs or stores the password`: `password123` is absent from the logs and mismatches JSON
  - `no steps recorded during auto-login`: `stepCounter === 0`
  - `wrong key → manual fallback logged`
- [ ] **Steps 3–4:** implement, then `npm run build:engine && npm run test:unit && npm run test:e2e -- login` → PASS.
- [ ] **Step 5: Commit** `feat(security): encrypted secret store and profile auto-login`

---

### Task 12: Persistent store + history API

**Files:** Create `qa-vision/lib/engine/store.ts` and `qa-vision/app/api/runs/route.ts`. Modify `qa-vision/lib/profile-manager.ts` (delegate to Store, migrate JSON) and `qa-vision/lib/playwright.ts:1639-1657` (archiveSession persists). Test `qa-vision/tests/unit/store.test.js`

**Interfaces:**
- `openStore(file?: string /* default data/qa-vision.db */): Store`. Uses `node:sqlite` `DatabaseSync`, `PRAGMA journal_mode=WAL`, and caches one instance per path on `globalThis.__qaVisionStores`.
- Schema (`CREATE TABLE IF NOT EXISTS`, `meta(schema_version)=1`):
  - `profiles(id PK, json, updated_at)`
  - `runs(id PK, profile_id, project_name, dev_url, prod_url, started_at, ended_at, summary_json)`
  - `findings(id PK, run_id, fingerprint, json)`, indexed on `run_id`
  - `logs(run_id, seq, json)`
  - `expectations(profile_id, fingerprint, note, created_at, PRIMARY KEY(profile_id, fingerprint))`
  - `secrets(ref PK, blob)`
- `interface Store { listProfiles(); getProfile(id); saveProfile(p); deleteProfile(id): boolean; saveRun(snap: SessionSnapshot & {profileId?: string}); listRuns(limit=50): RunSummary[]; getRun(id): SessionSnapshot|null; listExpectations(profileId); addExpectation(profileId, fingerprint, note); removeExpectation(profileId, fingerprint); putSecret(ref, blob); getSecret(ref): string|null; deleteSecret(ref) }`
- `RunSummary = {id, profileId, projectName, devUrl, prodUrl, startedAt, endedAt, counts: {total, bySeverity, byType, expected}}`
- Migration: on first open, import `data/profiles.json`. Plaintext `credentialsX.password` is encrypted into `secrets` with ref `profile:<id>:A|B` and dropped. The file is renamed to `profiles.json.migrated`.
- `GET /api/runs` returns the list. `GET /api/runs?id=` returns the snapshot, with screenshot paths reduced to file names.

- [ ] **Step 1: Failing tests** (temp file under `os.tmpdir()`):
  - `profiles CRUD round trip`
  - `saveRun then getRun returns logs and findings in order`
  - `listRuns counts by severity and type`
  - `expectations add/list/remove`
  - `migration encrypts plaintext passwords and removes them from profile json`
- [ ] **Steps 2–4:** FAIL → implement → PASS. Then `npm run test:e2e`: everything passes, and each session writes a runs row.
- [ ] **Step 5: Commit** `feat(storage): SQLite store for profiles, run history, findings, expectations and secrets`

---

### Task 13: Mark expected differences + highlight in browsers

**Files:** Create `qa-vision/app/api/findings/route.ts`. Modify `qa-vision/lib/playwright.ts` (createSession loads expectations into `session.expected`; new methods). Test `qa-vision/tests/e2e/expected-highlight.e2e.js`

**Interfaces:**
- `async markExpected(ref: {sessionId?: string; runId?: string}, findingId: string, expected: boolean, note = ''): Promise<{ok: boolean; finding?: Finding}>`. It updates the Store expectation for the profile and re-classifies the live (or stored) finding via `classifyFinding`. When live, it emits `mismatch-update`.
- `async highlightFinding(sessionId: string, findingId: string): Promise<{dev: boolean; prod: boolean; reason?: string}>`. It uses `devSelector`/`prodSelector`, falling back to the test id in `component`. It scrolls into view and injects a 3 s `<div data-qa-vision-highlight>` overlay over `getBoundingClientRect()` with `outline: 3px solid #f43f5e`, so page styles aren't mutated. The recorder ignores events inside `[data-qa-vision-highlight]`.
- `POST /api/findings {action:'mark-expected'|'unmark-expected'|'highlight'|'analyze', sessionId?, runId?, findingId, note?}`

- [ ] **Step 1: Failing e2e:**
  - `mark expected reclassifies live finding with provenance`
  - `expectation persists: second session on same profile classifies the same difference EXPECTED_DIFFERENCE on first comparison`
  - `expected differences remain visible in session.mismatches`
  - `highlight returns {dev:true, prod:true} for btn-add-user and overlay exists on both pages`
  - `highlight on DEV-only element returns prod:false with reason`
- [ ] **Steps 2–4:** FAIL → implement → `npm run build:engine && npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat: mark expected differences and highlight findings in both browsers`

---

### Task 14: AI analysis (Anthropic or OpenAI-compatible such as Grok)

**Before starting:** load the `claude-api` skill for current model ids and SDK usage.

**Files:** Create `qa-vision/lib/engine/ai.ts` and `qa-vision/.env.example`. Modify `qa-vision/package.json` (add `@anthropic-ai/sdk`) and `qa-vision/lib/playwright.ts`. Test `qa-vision/tests/unit/ai.test.js` (fake provider only)

**Interfaces:**
- `types.ts`: `interface AiAnalysis { status: 'ok'|'unavailable'|'error'; provider: string; model: string; explanation: string; observedFacts: string[]; hypotheses: string[]; suggestedInvestigation: string[]; additionalTests: string[]; proposedClassification?: Classification; confidence?: number; error?: string; generatedAt: string }`
- `interface AiProvider { name: string; model: string; complete(system: string, user: string, signal: AbortSignal): Promise<string> }`
- `providerFromEnv(env): AiProvider|null` reads:
  - `QA_VISION_AI_PROVIDER` = `anthropic` | `openai-compatible` | unset (→ null)
  - `ANTHROPIC_API_KEY`
  - `QA_VISION_AI_BASE_URL` (e.g. `https://api.x.ai/v1`)
  - `QA_VISION_AI_API_KEY`
  - `QA_VISION_AI_MODEL`

  `openai-compatible` calls `POST {base}/chat/completions` with `fetch`. Server-side only.
- `redactForAi(f: Finding, sensitiveRe: RegExp): object` keeps `type, component, property, page, devValue, prodValue, description, classification, stepIds`. It replaces emails, UUIDs, ≥16-char tokens, digit runs ≥ 9 and `[redacted]` markers with `<redacted>`. No screenshot paths, no URL queries.
- `buildPrompt(findings: object[]): {system, user}`. The system prompt says: analyze deterministic DEV vs PROD differences; separate observed facts from hypotheses; no defect claims without evidence; never suggest deploying or modifying code automatically; reply with JSON `{results:[{id, explanation, observedFacts, hypotheses, suggestedInvestigation, additionalTests, proposedClassification, confidence}]}`.
- `analyzeFindings(findings: Finding[], provider: AiProvider|null, opts: {timeoutMs: number /*30000*/; maxFindings: number /*40*/; batchSize: number /*10*/}): Promise<Map<string, AiAnalysis>>`
  - Never throws.
  - A null provider gives `unavailable`. Malformed JSON, a timeout or an HTTP error gives `error`.
  - An invalid `proposedClassification` is dropped.
- Engine:
  - After Stop and archive, run `analyzeFindings` in the background. Write the results to `finding.ai`, re-save the run, and emit `mismatch-update`.
  - `analyzeFinding(ref, findingId)` serves `POST /api/findings {action:'analyze'}`.
  - `classification` is never changed by AI.

- [ ] **Step 1: Failing tests:**
  - `no provider → unavailable, no throw`
  - `provider timeout leaves findings intact`: the provider never resolves, `timeoutMs 50`; expect `error`, with the inputs deep-equal to their clones
  - `malformed JSON → error`
  - `AI proposed classification is advisory`
  - `invalid proposedClassification dropped`
  - `redactForAi strips sensitive values`: `test@acme.com` and `abcdef1234567890XYZ` are gone
  - `prompt system text requires facts vs hypotheses`
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Live smoke** (only with a key): set `QA_VISION_AI_PROVIDER=anthropic`, run, Stop, and confirm `ai.status === 'ok'`. Otherwise write "not verified live" in the commit body.
- [ ] **Step 6: Commit** `feat(ai): pluggable grounded AI analysis with redaction and graceful failure`

---

### Task 15: Reports — HTML, JSON, Excel, CSV + richer PDF

**Files:** Create `qa-vision/lib/engine/reports/{model,html,json,xlsx,csv}.ts`. Modify `qa-vision/lib/report-generator.ts` and `qa-vision/app/api/report/route.ts`. Test `qa-vision/tests/unit/reports.test.js`

**Interfaces:**
- `buildReportModel(snap: SessionSnapshot): ReportModel`, where `ReportModel = {meta:{projectName, devUrl, prodUrl, runId, startedAt, endedAt, generatedAt}; summary:{pagesTested, interactions, comparisons, totalFindings, bySeverity, byType, byClassification, expected, replayIssues, skippedUnsafe}; timeline: Array<{stepId, action, devResult, prodResult, status, findingIds}>; findings: Finding[]}`
  - `interactions` counts logs matching `/^\[step-\d+\] Replicating/`.
  - `comparisons` counts logs starting `Compared after`.
- `renderHtml(model, images: Map<string, string /*base64*/>): string`
  - One self-contained file. Screenshots are `data:` URIs downscaled to ≤ 1200 px with sharp.
  - Every value goes through `escapeHtml`.
  - Sections: executive summary, severity breakdown, differences by type, expected differences, replay issues, skipped unsafe actions, timeline, AI analysis (facts and hypotheses labelled separately), evidence.
- `renderJson(model): string` has no images and file names only.
- `renderXlsx(model): Promise<Buffer>` has sheets `Summary`, `Findings`, `Timeline` and `Expected`.
- `renderCsv(model): string` has the findings, RFC 4180, with cells starting `= + - @` prefixed by `'`.
- Route: `POST /api/report {format:'pdf'|'html'|'json'|'xlsx'|'csv', sessionId?, runId?}`, served with the correct content type. The PDF adds the severity and type breakdown, expected differences, AI analysis when `ai.status==='ok'`, and selector/property.

- [ ] **Step 1: Failing tests:**
  - `summary counts by severity, type and classification`
  - `html escapes finding text` (`<script>` → `&lt;script&gt;`)
  - `html contains every section heading`
  - `json report has no absolute paths`
  - `xlsx has 4 sheets and N finding rows` (read back with exceljs)
  - `csv guards formula injection`
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(reports): HTML, JSON, Excel and CSV exports; richer PDF`

---

### Task 16: Dashboard — live view, timeline, filters, evidence, history, settings

**Files:**
- Create: `qa-vision/app/components/{LiveView,Timeline,FindingsPanel,EvidenceViewer,HistoryTab,ProfileSettings}.tsx`, `qa-vision/app/api/evidence/route.ts`, `qa-vision/tests/ui/dashboard.ui.js`
- Modify: `qa-vision/app/page.tsx`, `qa-vision/lib/playwright.ts` (frame streaming), `qa-vision/package.json` (`test:ui`: starts `server.js` and the sample apps if they are down, and stops what it started)

**Interfaces:**
- Engine `startFrameStream(sessionId)` / `stopFrameStream(sessionId)`. Every 1000 ms while running, not paused, and with ≥ 1 socket connected, it emits `frame {sessionId, side, data: base64 JPEG q50, url: urlForLog(...)}`. It skips a tick if the previous one is still in flight.
- `GET /api/evidence?session=&file=` resolves only inside `reports/evidence/<session>/`, serves only `.png`, and returns 400 on `..` or absolute paths.
- `LiveView` shows two mirrored frames plus URL bars and sync state, labelled "Live view: interact in the QA Vision DEV window".
- `Timeline` has a row per step with the linked finding count; clicking it filters the findings.
- `FindingsPanel` filters by type, severity and classification, has search, and groups by page | type | element. Expected differences stay listed, dimmed, behind a "Show expected" toggle that defaults to on.
- `EvidenceViewer` shows the images, values, selector/property, steps, `ruleApplied`, and AI facts vs hypotheses. It has buttons **Mark expected / Unmark**, **Highlight in browsers** and **Analyze with AI**.
- `HistoryTab` lists runs, opens a run read-only, and exports all 5 formats.
- `ProfileSettings` covers `CaptureSettings`, `LoginConfig` (the password is write-only and shows `•••• stored` once saved), data rules, API checks and DB checks. Profile actions: create, edit, **duplicate**, delete.
- The Report tab gets 5 export buttons.

- [ ] **Step 1: Failing UI tests:**
  - `profile duplicate creates "<name> (copy)"`
  - `launch shows two live frames within 5s`
  - `finding filters narrow list`
  - `clicking a finding opens evidence with images that load (naturalWidth > 0)`
  - `mark expected dims the finding and persists in history`
  - `history exports HTML (content-type text/html)`
  - `evidence route rejects ../ traversal with 400`
  - `saved password is never returned by GET /api/profiles`
- [ ] **Steps 2–4:** FAIL → implement → `npm run build:engine && npm run test:ui` → PASS. Run `npx tsc --noEmit -p .` and `npm run lint`, and expect no new errors in the touched files.
- [ ] **Step 5: Commit** `feat(dashboard): live view, timeline, filters, evidence viewer, history and profile settings`

---

### Task 17: API endpoint checks + read-only database checks

**Files:** Create `qa-vision/lib/engine/data-sources.ts`. Modify `qa-vision/package.json` (add `pg`), `qa-vision/lib/playwright.ts` and `ProfileSettings.tsx`. Test `qa-vision/tests/unit/data-sources.test.js`

**Interfaces:**
- `interface ApiCheck { name: string; path: string; fields: string[] /* dot paths */; rule?: DataRule; whenPathStartsWith?: string }`
- `interface DbCheck { name: string; devConnRef: string; prodConnRef: string /* secret refs */; sql: string; rule?: DataRule }`
- `runApiCheck(check, devCtx: APIRequestContext, prodCtx: APIRequestContext, devBase, prodBase): Promise<FindingDraft[]>`
  - **GET only**, through each context's `request`, so each environment's own cookies apply.
  - Each field goes through `compareValues`. A missing field is `high`. Findings are `type:'Data'` with component `api:<name>.<field>`.
- `assertReadOnlySql(sql: string): void` throws unless the comment-stripped SQL starts with `SELECT` or `WITH`, contains none of `insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|call|do|vacuum|lock|set` as words, and has no `;` except a trailing one.
- `runDbCheck(check, getSecret): Promise<FindingDraft[]>`
  - Runs `BEGIN READ ONLY`, `SET LOCAL statement_timeout = 5000`, the query (with `LIMIT 500` appended if absent), then `ROLLBACK`.
  - Compares row counts and cells via `compareValues`.
  - Never logs connection strings.
- Both run at session start, and after a comparison when `whenPathStartsWith` matches DEV's path.

- [ ] **Step 1: Failing tests:**
  - `assertReadOnlySql accepts SELECT/WITH, rejects "select 1; drop table x", "update t set a=1", "with x as (delete from t returning *) select * from x"`
  - `runApiCheck compares fields` (stub contexts `{data:{total:5}}` vs `{data:{total:6}}`)
  - `runApiCheck refuses non-GET` (the stub throws on anything but `get`)
  - `runDbCheck integration`: runs only with `QA_TEST_PG_URL`, else skips with `QA_TEST_PG_URL not set`
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(data): API endpoint checks and read-only database comparison`

---

### Task 18: Docs + final verification

**Files:** Modify `README.md`, `qa-vision/.env.example` and `README-SAMPLE-APPS.md`.

- [ ] **Step 1:** Update "What works today", "Known limitations", the Tests table, the env vars and the Node 22.13 floor. Each newly claimed feature names the test that proves it. Anything not verified live (AI without a key, Postgres without `QA_TEST_PG_URL`) is marked "implemented, not verified in CI".
- [ ] **Step 2: Full verification:**
  - `npm run build:engine && git diff --exit-code engine-dist playwright.js`
  - `npx tsc --noEmit -p .`
  - `npm run test:unit`
  - `npm run test:e2e`
  - `npm run test:ui`

  All must pass.
- [ ] **Step 3: Commit** `docs: document full-spec features, env vars and verification`. Push or open a PR only when the user asks.

---

## Self-Review Notes

- **Spec coverage.**
  - Profiles, duplicate, history: Tasks 12 and 16. Login and secret store: Task 11. Capture settings and scopes: Task 2. Richer capture: Task 10.
  - DOM and forms: Task 4. CSS and layout: Task 5. Accessibility: Task 6. Data: Tasks 7 and 17. Network and console: Task 8.
  - Classifications, confidence and provenance: Tasks 1 and 13. AI: Task 14. Dashboard: Task 16. Reports: Task 15.
  - Security: Tasks 11, 14 and 16.
- **Gaps left on purpose, to be listed in the README:** PostgreSQL as the primary store (the SQLite deviation); an embedded *interactive* browser in the dashboard (the live view is a mirror); app-version capture (no generic way to read it).
