# QA VISION MASTER — Dynamic Two-Application Comparison

**Version:** 1.0  
**Purpose:** Implementation-ready requirements and master prompt for Grok or another coding agent.  
**Status:** Proposed requirements; do not assume any feature already exists.

## 1. Vision

Build **one permanent QA Vision Master application** that controls comparisons between **any two configurable web application environments**. QA Vision itself remains unchanged as target URLs, routes, accounts, deployments, and application designs change.

Typical pairing is DEV (user-controlled) versus PROD (reference), but labels and URLs must be configurable. The user enters or selects the target URLs at runtime; **no localhost URL or sample app is hardcoded into comparison logic**.

The two targets may share the same product, domain family, page structure, or business workflow, but they can differ in hostname, subdomain, base path, port, authentication mechanism, feature flags, data, deployment version, and UI. Do **not** assume the literal hostnames are identical. For example:

- DEV: `https://dev.example.com/app` and PROD: `https://www.example.com/app`
- DEV: `https://example.com/dev` and PROD: `https://example.com/prod`
- DEV: `http://localhost:3002` and PROD: `http://localhost:3003`

These are examples only. Allow arbitrary authorized HTTPS/HTTP targets according to deployment policy.

## 2. User Workflow

1. Open QA Vision Master (permanent dashboard).
2. Create/select a **comparison profile** with a human-readable name, target A (DEV) URL, target B (PROD) URL, environment labels, optional route mapping, account configuration, and comparison rules.
3. Launch **two independent browser contexts**. Authenticate to each target separately, using its own credentials or supported SSO flow. Support manual login and secure reuse of session state where permitted; never display or log passwords/tokens.
4. Show both sessions (side-by-side live views if technically supported, otherwise separately controlled browser windows or a streamed view). Do not rely on iframes: many applications prohibit embedding.
5. Click **START COMPARISON** in QA Vision. This begins action capture on DEV and controlled replay on PROD.
6. The user navigates and interacts with DEV. For every supported action, QA Vision identifies the semantic target, finds the equivalent target in PROD, replays the action if safe, waits for comparable states, and performs comprehensive comparison.
7. Stream progress, screenshots, mismatches, replay failures, and evidence to the master dashboard in real time.
8. Click **STOP COMPARISON**. Stop accepting new actions, finish or safely cancel in-flight work, persist the run, and generate a report.
9. Review differences, mark expected differences, create ignore/baseline rules, and export evidence.
10. Switch to another pair of URLs or another comparison profile without changing or rebuilding QA Vision.

## 3. Runtime Configuration (No Hardcoded Target URLs)

Profile fields:

| Field | Requirement |
|---|---|
| Profile name | Required, unique per workspace |
| DEV/base URL | Required, validated and normalized |
| PROD/base URL | Required, validated and normalized |
| Environment labels | Editable; DEV/PROD are defaults |
| Login strategy | Manual, credentials through secret store, or supported SSO |
| Session handling | Separate isolated cookies, storage, permissions, and auth state |
| Route mapping | Optional rules for different route structures |
| Element mapping | Optional stable test IDs, roles, labels, selectors, or explicit overrides |
| Comparison rules | Include/exclude regions, dynamic-field normalization, severity thresholds |
| Safety policy | Read-only by default for PROD; explicit action allowlist |
| Capture settings | Screenshots, DOM, CSS, API/network metadata, traces |
| AI settings | Provider/model configuration, secure API key reference, redaction policy |

Persist profiles and run history in a database. Allow creating, editing, duplicating, deleting, and switching profiles. Validate URL schemes and guard against SSRF, access to internal metadata services, and unauthorized targets. Apply an organization-managed allowlist where appropriate. Never put secrets in profile JSON or browser console logs.

## 4. Real-Time Dual-Environment Synchronization

**Fundamental rule:** A manual action in DEV becomes an equivalent *safe* automated action in PROD; both resulting states are compared. This is semantic replay, **not coordinate mirroring**.

Capture: clicks, navigation, link activation, typing, field clearing, checkbox/radio changes, dropdown selection, tabs, accordion expansion, modal open/close, filtering, sorting, pagination, scrolling where relevant, and safe form submission. Handle SPAs, route transitions, asynchronous rendering, dialogs, new tabs, and loading states.

Action record should include `runId`, `stepId`, timestamp, source URL/route, action type, element role/name/label/test-id/selector candidates, sanitized input, page state, replay outcome, and correlation IDs.

**Mapping priority:** explicit user-configured mapping > stable test ID > accessible role/name > associated label > text/DOM context > validated structural fallback. Detect ambiguous or missing matches; do not blindly click the first match. Never assume same coordinates, CSS class, or exact DOM hierarchy.

**Timing:** queue events in order, prevent duplicate capture/replay loops, wait for meaningful application readiness and settled UI with configurable timeouts (avoid relying exclusively on `networkidle`), compare equivalent routes/states, and record timing/replay failures separately from visual differences.

When PROD lacks a DEV-only feature, record `UNMAPPED_OR_MISSING_FEATURE` and continue safely. If an action is unsafe or disallowed, record `SKIPPED_BY_SAFETY_POLICY`; do not execute it.

## 5. Comprehensive Comparison

After initial login/navigation and after each meaningful action, capture comparable state and check:

1. **DOM:** missing/extra elements, tag/attribute differences, nesting, order, visibility, enabled/disabled state.
2. **Visual:** screenshot differences, bounding boxes, position, dimensions, spacing, alignment, responsive breakpoints, icons, images, overlays.
3. **CSS:** computed styles (font family/size/weight, color, background, borders, margin, padding, display, position, flex/grid properties). CSS class-name differences alone are not defects.
4. **Text/content:** headings, labels, placeholders, buttons, tooltips, alerts, error messages, modal content, whitespace/formatting when meaningful.
5. **Forms:** required fields, field type, validation messages, max/min lengths, state transitions, submitted behavior (subject to safety policy).
6. **Data:** tables, cell values, totals, counters, monetary/date/number formatting, sort/filter results, missing/null/extra fields.
7. **Navigation/functionality:** URLs/routes, redirects, modals, tabs, menus, pagination, interactive state changes, permissions.
8. **Network/API:** request method/path, status, response schema and selected non-sensitive payload fields where legally/technically permitted; avoid exposing secrets and personal data.
9. **Accessibility:** roles, accessible names, labels, focus behavior, keyboard interaction, ARIA attributes.
10. **Runtime issues:** console errors, failed requests, uncaught exceptions, hydration failures, broken assets.

Support **comparison scopes**: full page, viewport, selected component, table, form, or specific field. Identify page/component/element path for every finding. Preserve screenshots and relevant sanitized DOM/CSS snapshots for evidence.

## 6. Avoid False Positives

DEV and PROD are not always expected to have identical data or features. Provide configurable normalization and exclusions for timestamps, random IDs, session identifiers, user names, counters, environment banners, analytics scripts, A/B experiments, feature flags, and legitimate release changes. Offer exact-match, schema-only, semantic, numeric tolerance, regex-ignore, and field-exclusion policies.

Classify results as `MATCH`, `EXPECTED_DIFFERENCE`, `POTENTIAL_DEFECT`, `REPLAY_FAILURE`, `NOT_COMPARABLE`, or `SKIPPED_BY_SAFETY_POLICY`. **AI can propose a classification, but should not silently suppress differences or declare every difference a defect.** Show supporting evidence, confidence, and rule provenance.

## 7. Production Safety (Non-Negotiable)

PROD must be **read-only by default**. Do not automatically replay account creation, deletes, writes, purchases, payments, transfers, emails, notifications, irreversible submissions, or state-changing API calls. Do not assume an HTTP GET is always harmless. Use action-level safety checks and explicit per-profile allowlists. For risky or uncertain actions, pause/skip and require user approval or use a safe mock/sandbox account. Honor access permissions, audit activity, rate limits, and organization policy. No security bypasses.

Sanitize screenshots, traces, logs, API data, and prompts before sending them to Grok or any external LLM. Use a secret manager or server-side environment variables for AI API keys; never expose keys in frontend code.

## 8. QA Vision Master Dashboard

Persistent UI sections:

- **Profiles:** create/edit/select DEV–PROD target pairs, configure routes, mapping, exclusions, safety rules.
- **Session status:** launch browsers, connect/authenticate DEV and PROD independently, show current URL and login state.
- **Controls:** START COMPARISON, PAUSE/RESUME, STOP COMPARISON, safe recovery/retry.
- **Live dual view:** DEV (user-controlled) and PROD (automated) live windows/streams when supported; otherwise open separate Playwright-managed windows.
- **Live event timeline:** each captured DEV action, matched PROD action, replay status, timing, and linked findings.
- **Comparison results:** grouped by page, element, category, severity, confidence, expected/unexpected, with filtering and search.
- **Evidence viewer:** side-by-side screenshots, visual diff overlay, DOM/CSS/text/data before/after, network/console evidence.
- **History/reports:** runs, profile, timestamps, app versions, metrics, exported HTML/JSON/PDF and optionally CSV.

Stop should display the **complete consolidated report**, not only the last screenshot.

## 9. Suggested Architecture

- **Frontend:** Next.js + React + TypeScript (master dashboard).
- **Automation service:** Node.js + Playwright, with isolated browser contexts and lifecycle management.
- **Event streaming:** WebSockets/Socket.IO for run state, action capture, replay progress, and findings.
- **Comparison engine:** structured DOM/style/data checks plus screenshot diffing; deterministic comparisons first.
- **AI analyzer:** optional Grok API for summarization, clustering, prioritization, and root-cause hypotheses; retain raw deterministic evidence and work without AI if API is unavailable.
- **Storage:** PostgreSQL for profiles/runs/findings; protected artifact storage for screenshots, traces, and exports.
- **Jobs:** per-run ordered action queue, cancellation, retries, backpressure, concurrency limits.

Suggested modules: `profile-service`, `session-manager`, `dev-action-recorder`, `element-mapper`, `prod-replay-engine`, `state-synchronizer`, `comparison-engine`, `ai-analysis-service`, `safety-policy-engine`, `report-service`, `realtime-gateway`.

Note: observing *manual* interaction in a Playwright-managed DEV window requires deliberate instrumentation (e.g., an authorized injected recorder script or browser extension). Playwright alone does not automatically capture every human action performed in an arbitrary existing browser tab. Implement and test this explicitly.

## 10. Finding Record and Reporting

Each finding should include:

```json
{
  "runId": "example-run",
  "stepId": "step-0007",
  "devRoute": "/users",
  "prodRoute": "/users",
  "action": "click: Users tab",
  "category": "TEXT_DIFFERENCE",
  "element": "role=heading,name=Active Users",
  "devValue": "1,250",
  "prodValue": "1,248",
  "classification": "POTENTIAL_DEFECT",
  "severity": "medium",
  "confidence": 0.85,
  "evidence": ["dev-screenshot", "prod-screenshot", "dom-diff"],
  "ruleApplied": null,
  "replayStatus": "SUCCESS"
}
```

This is an illustrative schema, not an actual test result. Reports should provide executive summary, action-by-action timeline, matched steps, expected differences, unexpected differences, replay issues, skipped unsafe actions, and reproducible evidence.

## 11. Sample Apps Are Fixtures, Not Fixed Dependencies

Existing demo apps may run at `localhost:3002` (DEV) and `localhost:3003` (PROD), with QA Vision at `localhost:3001`. These are **optional test fixtures** only. Do not hardcode them. Preserve `npm run start:all` if already working, but QA Vision must accept any authorized comparison pair at runtime.

Use sample scenarios: DEV green vs PROD blue banner, user count 1250 vs 1248, different validation messages, DEV-only interactive chart, disabled PROD Add User. These are useful *detections*, but require configurable classification as intentional or defect.

## 12. Implementation Phases

**Phase 0 — Audit:** inspect repository structure, current endpoints, scripts, tests, features, and gaps. Report what exists, what is partially working, and what is missing. Do not claim functionality without running tests.

**Phase 1 — Dynamic profiles:** create/edit/select arbitrary URL pairs, secure auth/session isolation, persistence, input validation.

**Phase 2 — Synchronized capture/replay:** DEV recorder, semantic element mapping, safe PROD replay, ordered queue, live status.

**Phase 3 — Deterministic comparisons:** DOM, CSS, visual, text, forms, data, navigation, API metadata, console.

**Phase 4 — Rules and AI:** false-positive reduction, environment exceptions, Grok-assisted analysis with evidence and redaction.

**Phase 5 — Reports and hardening:** stop/finalize, artifact exports, failure recovery, security controls, performance, multi-profile regression.

## 13. Acceptance Criteria

- [ ] QA Vision Master runs independently of either target app.
- [ ] User can change DEV/PROD URLs from UI without code edits or restarts.
- [ ] Two distinct comparison profiles work back-to-back.
- [ ] Separate credentials/sessions work without cookie or token leakage.
- [ ] Start captures real user actions in the DEV controlled session.
- [ ] A safe DEV action replays semantically in PROD and is visibly reflected there.
- [ ] Missing/ambiguous PROD element is reported, not silently clicked.
- [ ] Initial and post-action comparisons produce evidence for each page.
- [ ] CSS, DOM, text, form, data, screenshot, and functional differences can be detected.
- [ ] Dynamic content can be excluded or normalized via UI rules.
- [ ] Unsafe PROD mutations are blocked by default and audited.
- [ ] Pause, resume, and stop work predictably.
- [ ] Stop produces a consolidated report with step-level screenshots and differences.
- [ ] AI failure does not prevent deterministic comparisons or reports.
- [ ] Secrets/PII are protected in artifacts and LLM requests.
- [ ] Sample apps remain optional fixtures, not required target URLs.

## 14. MASTER PROMPT FOR GROK — Paste This Section Along with the File

You are the lead architect and senior QA automation engineer for an existing project called **QA Vision Master**. The attached Markdown specification is the source of truth.

**Mission:** Upgrade the existing QA Vision into a permanent, dynamic, production-conscious dual-application comparison platform. QA Vision must compare arbitrary runtime-configured DEV and PROD URL pairs. It must record my manual interactions in DEV, safely replay semantically equivalent actions in PROD, compare page/element/text/CSS/DOM/data/behavior after each step, stream live results, and produce a consolidated evidence-based report when I press STOP.

**Work rules:**

1. **Inspect the current repository first.** Identify its actual framework, app directories, scripts, running services, and working features. Do not assume the example ports or feature claims are accurate.
2. Produce an **implemented / partial / missing / broken** gap matrix mapped to this document.
3. Preserve existing working features. Do not rebuild from scratch without a technical reason and my approval.
4. Implement **runtime-configurable target pairs**; never hardcode the DEV and PROD URLs into the engine.
5. Build a reliable DEV manual-action recorder, semantic PROD replay, state synchronization, comparison engine, evidence pipeline, and dashboard controls.
6. Keep PROD **read-only by default**; block risky actions. Isolate auth and protect secrets/PII.
7. Use deterministic comparisons as primary evidence. Use Grok only for optional grounded analysis, categorization, and explanations. Never fabricate findings.
8. Provide runnable code changes, migrations, configuration examples, tests, and exact commands for local execution.
9. Run available automated checks and demonstrate a real end-to-end comparison against the sample apps; clearly distinguish verified results from assumptions.
10. Show me what currently works, what still fails, and the next concrete development steps. Ask questions only where a security or architectural choice genuinely blocks implementation.

**Important:** I want to interact with DEV manually and watch PROD automatically follow; QA Vision is the central control and reporting app. The target URLs and applications can change for each run. Do not implement a static screenshot-only comparison.

---

**End of QA Vision Master Dynamic Two-Application Comparison specification.**
