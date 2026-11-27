# QA VISION MASTER SKILL

**One consolidated source of truth for QA Vision** — Dynamic Two-Application Comparison Platform (DEV vs PROD or any pair of URLs).

**Project Root:** `C:\Users\amane\OneDrive - MetTel\Documents\App\Two Screen Compare\`

**Current Status (verified 2026-11-27):** Live comparison feature as in "What works today". Two Screen Comparison tab implements the Data-First spec (section 8): selectable scope with Data & Text default, local OCR data extraction with exact DEV/PROD values, uncertain handling, ignored fields/regions, priority-ordered report and exports. See section 8 "Implementation status" for what is verified and the remaining limitations.

---

## 1. Vision (from QA_Vision_Dynamic_Two_App_Comparison_Grok.md + Master Prompt)

QA Vision is a **permanent, production-safe master dashboard** that lets users configure *any* two web application URLs at runtime (no hardcoded localhost or sample apps in core logic).

- User creates/selects a **Comparison Profile** (DEV URL, PROD URL, labels, login config, safety rules, ignore rules, capture settings).
- Launches two isolated Playwright browser contexts.
- **DEV** is manually controlled by the user (in the Live View pane or separate window).
- Actions are semantically captured, mapped, safely replayed on PROD, and both sides are comprehensively compared after each meaningful step.
- Real-time dashboard shows timeline, live mirrored views, findings, evidence (screenshots, DOM, CSS, network).
- Stop generates a full consolidated report (HTML, PDF, JSON, Excel, CSV).
- All PROD actions are read-only by default with strong safety guards.

Sample apps (`sample-dev:3002`, `sample-prod:3003`) are **optional test fixtures only** with intentional differences (colors, counts, text, validation, features).

---

## 2. Master Prompt for Any Coding Agent

You are the lead architect and senior QA automation engineer for **QA Vision**.

The attached `QA_VISION_MASTER.md` (this file) + the current codebase (`qa-vision/`, `sample-dev/`, `sample-prod/`, `README.md`) are the source of truth.

**Mission:** Maintain, extend, or fix QA Vision while strictly following the vision, safety rules, and dynamic profile requirements.

**Work Rules (non-negotiable):**
1. Always inspect the current repository first (`npm run build:engine`, run tests, check running services).
2. Never hardcode any URLs (especially not localhost:3002/3003) into comparison or replay logic.
3. Preserve all existing working features and tests.
4. PROD must remain read-only by default. Every new action type must go through `evaluateAction` / safety policy.
5. Use the pure engine modules in `lib/engine/` for all comparisons (unit-testable).
6. After changing `lib/engine/` or `lib/playwright.ts`, always run `npm run build:engine`.
7. Deterministic comparisons first. AI (Anthropic/Grok-compatible) is optional, advisory only, with full redaction.
8. Run all tests (`npm run test:unit`, `npm run test:e2e`, `npm run test:ui`) after changes.
9. Document any deviations in README.md.

---

## 3. Architecture Summary (from 2026-11-23 full-spec plan)

- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind (dashboard at :3001)
- **Automation:** Playwright (isolated contexts, recorder in DEV, semantic replay in PROD)
- **Engine:** Pure TypeScript modules in `lib/engine/` → compiled to `engine-dist/` (DOM, CSS, Layout, A11y, Data, Network, Console, Visual, AI analysis, reports)
- **Storage:** SQLite (`data/qa-vision.db`) via `lib/engine/store.ts` (profiles, runs, findings, expectations, encrypted secrets)
- **Real-time:** Socket.IO + live frame streaming (JPEGs)
- **Reports:** HTML, PDF, JSON, Excel, CSV with evidence
- **Security:** Encrypted secrets, network guard, read-only SQL, redaction for AI/prompts/logs

Key files:
- `lib/playwright.ts` + `playwright.js` (orchestrator)
- `lib/engine/*.ts` (all comparison logic)
- `app/components/*` (LiveView, FindingsPanel, Timeline, EvidenceViewer, HistoryTab, ProfileSettings)
- `tests/` (comprehensive unit + e2e + ui)

---

## 4. What Works Today (Verified)

See `qa-vision/README.md` and main `README.md` for the full table. Highlights:
- Dynamic profiles, history, duplicate, settings (capture, login, data rules, expectations)
- Full action capture/replay (click, dblclick, hover, keyboard, forms, navigation)
- Comprehensive comparisons (DOM, CSS/Layout, A11y, Data with rules, Network/API, Console, Visual/pixelmatch, Text)
- Safety (read-only default, allowlist, network guard, audited skips)
- Encrypted auto-login + secret store
- Mark expected differences + browser highlighting
- Live mirrored views, timeline, filters, evidence viewer
- Rich reports (all formats, screenshots, AI analysis when available)
- All major tests passing (`npm test`)

AI and Postgres DB checks are implemented with graceful fallbacks (not verified live without keys/URL).

---

## 5. Quick Start Commands (from root or qa-vision/)

```powershell
# From root
npm run start:all          # Starts QA Vision + sample-dev + sample-prod

# Or individually
cd qa-vision && npm run start:real
cd sample-dev && npm run dev
cd sample-prod && npm run dev
```

Open http://localhost:3001

Login for samples: `test@acme.com` / `password123`

Run tests: `cd qa-vision && npm test`

Rebuild engine after edits: `npm run build:engine`

---

## 6. How to Use This Skill

When the user asks anything about QA Vision, Two Screen Compare, DEV vs PROD comparison, or related work:
1. Read this file first.
2. Read the current `qa-vision/README.md` and main `README.md`.
3. Inspect the actual codebase with tools before making changes.
4. Follow the Master Prompt rules above.
5. Preserve safety, dynamic configuration, and test coverage.

**This file supersedes all previous individual prompt documents.**

**End of QA VISION MASTER Skill (Live Comparison section)**

---

## 8. QA Vision — Two Screen Comparison: Data-First Skill Update (Highest Priority)

**Purpose:** Add or update the Two Screen Comparison tab in the existing QA Vision application. This is an additive feature specification intended to be merged into the project's existing SKILL.md or QA_vision_master.md. Do not remove existing capabilities. The earlier live DEV/PROD browser synchronization feature is out of scope for this tab.

### 1. Product objective
Allow a QA engineer to paste or upload one DEV screenshot and one PROD screenshot and compare their visible business data first, images/diagrams second, and visual styling only when explicitly selected. PROD is the comparison baseline, not necessarily the authoritative source of truth for intentional changes. Report meaningful mismatches with precise evidence and avoid flooding the report with minor CSS or alignment noise.

### 2. UI: New tab and selectable comparison scope
Tab label: Two Screen Comparison.

Provide two labeled screenshot panels:
- DEV Screenshot: paste from clipboard (Ctrl+V), drag and drop, or upload PNG/JPEG/WebP.
- PROD Screenshot: paste from clipboard (Ctrl+V), drag and drop, or upload PNG/JPEG/WebP.
Each panel should show a preview, replace/remove action, file dimensions, and upload/validation errors. Support differing screenshot resolutions and scroll positions with alignment/region matching; do not compare unrelated regions as if equivalent.

Under What do you want to compare?, show independent checkboxes with these defaults:

| Option                  | Default   | Priority | Meaning |
|-------------------------|-----------|----------|---------|
| Data & Text             | Checked   | P1       | Visible business values, table cells, labels, numbers, dates, currencies, statuses, IDs, totals, counts, error messages |
| Images & Diagrams       | Unchecked | P2       | Missing/wrong images, charts, icons with business meaning, diagram nodes, labels, plotted values, legends |
| CSS & Visual Styling    | Unchecked | P3       | Colors, font family/weight/size, borders, backgrounds, spacing, element styling |
| Alignment & Layout      | Unchecked | P3       | Element positions, dimensions, overlap, clipping, misalignment |
| Form Elements & States  | Unchecked | P3       | Visible field labels, placeholders, checked/selected states, enabled/disabled appearance, missing controls |

Users can check any combination, including only images or only CSS. Require at least one option before comparison. Do not silently run or report unselected categories. Keep the Data & Text option selected by default on a fresh comparison; let the user deselect it.

Controls: Compare Screenshots, Clear, Download Report, optional Ignore Regions and Comparison Settings. Display selected scope clearly on results. Do not trigger comparison before both screenshots are supplied.

### 3. Data-first comparison requirements (highest priority)
Extract and compare visible text and data from semantically corresponding screenshot regions. Use OCR and/or a vision-language model with spatial grounding; preserve bounding boxes, confidence, and raw extracted text. Normalize only safe presentation variations, with configurable rules. Compare:
1. Numbers: counts, quantities, decimals, negative signs, percentages, totals, balances, prices.
2. Currencies and dates: amounts, currency symbols/codes, locale formats, dates and times, time zones when visible.
3. Identifiers: order IDs, user IDs, invoice numbers, transaction references; exact match unless configured otherwise.
4. Tables: headers, row/column relationships, missing/extra rows, changed cell values, row matching by stable visible key rather than row position when possible.
5. Labels and statuses: headings, captions, status badges, errors, warnings, field labels, button text.
6. Forms: visible input values and selections, when included in Data & Text; deeper state/appearance comparison belongs to Form Elements & States.
7. Missing/extra information: fields, text blocks, records, summary cards, values present on one screen but absent on the other.

Examples:
- PROD shows Active Users: 1,248; DEV shows Active Users: 1,250 → Data mismatch, not CSS.
- PROD shows ₹12,500.00; DEV shows ₹1,250.00 → High-priority amount mismatch.
- PROD status Approved; DEV status Pending → Status mismatch.
- PROD has invoice INV-101; DEV has INV-102 → Identifier mismatch.
- Both show 1,250 with different font colors → No data mismatch; report styling only if selected.

Avoid false positives:
- Identify and match corresponding regions/records before comparing values.
- Do not assume screenshot coordinates, table sort order, or viewport size are identical.
- Support configurable ignored fields/regions for timestamps, rotating banners, randomized IDs, personalized content, and known DEV-vs-PROD test-data differences.
- Support strict vs normalized text matching, numeric tolerance, currency/date locale normalization, and case/whitespace handling.
- Do not automatically ignore a value merely because environments differ; explain configured exclusions.
- If text is blurry, clipped, obscured, or unreadable, mark Uncertain / Needs Review rather than inventing a value or claiming a match.
- Only compare what is visible in the screenshots; do not claim to have checked hidden DOM values, CSS classes, APIs, or database records.

### 4. Image and diagram comparison (second priority)
When Images & Diagrams is selected:
- Detect image/illustration/diagram missing, extra, replaced, or substantially different.
- Compare charts for visible title, axis labels, legend, category labels, series count, plotted shapes, and legible displayed values.
- Compare diagrams for visible nodes, connections, text, direction, and omitted/extra elements.
- Distinguish semantic changes from harmless compression, antialiasing, resizing, or slight pixel variation.
- Highlight the relevant image/diagram area in both screenshots and explain the mismatch.
- If precise chart values cannot be read from pixels, state the limitation and mark uncertain; never fabricate values.

### 5. Optional visual, layout, and form checks
Only execute these if their corresponding checkbox is selected:
- CSS & Visual Styling: perceptual color, typography, borders, spacing, background changes; ignore subpixel rendering noise by default.
- Alignment & Layout: meaningful shifts, clipped text, overlap, missing sections, and component size changes with configurable pixel/percentage thresholds.
- Form Elements & States: missing controls, selected/checked state, disabled appearance, visible placeholder/value differences.

Screenshot-only limitation: font-family identity, actual CSS declarations/classes, DOM attributes, and real enabled/disabled semantics cannot be proven from a screenshot. Label such observations as visual estimates, not verified DOM facts. A future browser-backed mode may provide those details, but it is not required here.

### 6. Comparison pipeline
1. Validate two uploads and selected categories; handle invalid files, size limits, and privacy notices.
2. Preprocess screenshots: preserve originals, derive analysis copies, estimate scale and locate matching regions; avoid destructive resizing.
3. Detect visible UI sections, text boxes, tables, charts, and images with bounding boxes.
4. Match DEV and PROD sections by semantic content and structure, not only pixel position.
5. Run only selected analyzers; Data & Text runs by default.
6. Produce structured findings with source values, region coordinates, confidence, severity suggestion, and explanation.
7. Deduplicate overlapping findings (e.g., one wrong amount should not create five CSS/pixel findings).
8. Render annotated DEV and PROD previews with numbered highlight rectangles tied to finding IDs.
9. Generate a filterable report and export JSON, HTML, and PDF where supported.

For potentially sensitive screenshots, minimize retention, redact personal information in logs/reports where configured, and require explicit consent before sending images to external AI APIs. Never send secrets or screenshot content to Grok or another external model without user authorization.

### 7. Findings and report format
Summary must prioritize Data & Text, then Images & Diagrams, then optional visual categories. Display selected checks, matched items, confirmed mismatches, uncertain items, and ignored regions. Do not call unchecked categories "passed".

Each finding must include:
```json
{
  "id": "DATA-001",
  "category": "data_text",
  "severity": "high",
  "confidence": 0.97,
  "page_section": "Dashboard / Active Users card",
  "field": "Active Users",
  "prod_value": "1,248",
  "dev_value": "1,250",
  "expected_baseline": "PROD screenshot",
  "description": "Visible user count differs between DEV and PROD",
  "dev_bbox": [100, 150, 250, 205],
  "prod_bbox": [98, 148, 248, 203],
  "status": "mismatch",
  "review_note": "Confirm whether DEV is expected to contain different test data"
}
```
Bounding boxes above are illustrative only, not real screenshot measurements. Severity is a suggestion, not proof of business impact. Provide a side-by-side image viewer with linked highlighted regions, mismatch filters, and download/export. The report should not claim 100% accuracy or that invisible data was verified.

### 8. Acceptance criteria
- [x] Existing QA Vision features remain intact; a separate Two Screen Comparison tab is added.
- [x] DEV and PROD screenshots can each be pasted or uploaded and previewed.
- [x] Data & Text is checked by default; every other comparison category is unchecked by default.
- [x] User can select any combination of checks, including deselecting Data & Text.
- [x] Unselected categories produce no findings or pass claims.
- [x] Wrong numbers, statuses, dates, amounts, and table cells are highlighted with exact visible DEV/PROD values.
- [x] Same data with only color/font changes produces no data mismatch.
- [x] Missing/replaced chart or image is detected when Images & Diagrams is selected.
- [x] Pixel noise and minor alignment changes are suppressed when their categories are not selected.
- [x] Low-confidence/illegible content is explicitly flagged for review.
- [x] Findings link to accurate highlighted regions on both screenshot previews.
- [x] Results include a concise summary and detailed export.
- [x] Tests cover matching screenshots, mismatched data, missing records, different table sort order, different resolution, low-quality screenshots, and intentionally ignored regions.

#### Implementation status (verified 2026-11-27)
Code: `lib/engine/screenshot-ocr.ts` (local Tesseract OCR), `lib/engine/screenshot-data.ts` (data comparison), `lib/engine/screenshot-compare.ts` (scope, pixel checks, de-duplication, report model), `app/api/screenshot-compare/route.ts`, `app/components/ScreenshotComparison.tsx`.

| Acceptance criterion | Verified by |
|---|---|
| Separate tab, existing features intact | `test:ui:screenshot` (other tabs render, Live tab still opens), `test:unit`, `test:e2e`, `test:ui` |
| Paste/upload + preview per panel | `test:ui:screenshot` (focused-panel paste, drag-and-drop, bad image) |
| Data & Text default, others unchecked; any combination; at least one | `test:ui:screenshot`, `screenshot-compare.test.js` (scope tests, `no-scope` error) |
| Unselected categories: no findings, shown "Not checked" | `screenshot-compare.test.js`, `screenshot-data-ocr.test.js`, UI scope summary + HTML report |
| Wrong number/amount/status/ID/date/table cell with exact values | `screenshot-data-ocr.test.js` (real OCR: 1,250/1,248, $1,250.00/$12,500.00, Pending/Approved, INV-106/INV-104, 2026-11-22/2026-11-21), UI test |
| Same data, only color/font changes → no data mismatch | `screenshot-data-ocr.test.js` (restyled dashboard), UI test |
| Missing chart/image detected with Images & Diagrams | `screenshot-data-ocr.test.js`, `screenshot-compare.test.js`, UI test |
| Pixel noise / minor alignment suppressed when unselected | scope filter tests; restyled and 2× cases report nothing outside Data & Text |
| Low-confidence/illegible → Uncertain / needs review | `screenshot-data.test.js` (low confidence, unreadable side, number read as letters), `screenshot-data-ocr.test.js` (low-quality JPEG: zero claimed mismatches) |
| Findings linked to accurate boxes on both screenshots | `screenshot-data-ocr.test.js` (box on the value), UI test (click finding/box, zoom/pan) |
| Concise summary + detailed export | UI test (HTML "Selected checks"/"Not checked", JSON `spec_findings` in the snake_case schema) |
| Tests: matching, mismatched data, missing records, sort order, resolution, low quality, ignored regions/fields | `screenshot-data.test.js`, `screenshot-data-ocr.test.js` (fixtures in `public/test-screenshots/data/`, generator `scripts/make-data-screenshots.js`) |

Remaining limitations (documented in the root README): OCR is English-only and can misread small/stylized/low-contrast text (flagged uncertain — e.g. white text on a light-grey disabled button); row/field matching is heuristic; chart plotted values are not read; numeric dates with ambiguous day/month are compared as text; CSS/form-state observations are visual estimates; ~2–4 s per comparison.

### 9. Implementation instructions for Grok / coding agent
You are modifying an existing QA Vision codebase. First inspect the current app architecture, routes, tabs, dependencies, API handlers, image-processing utilities, and existing report components. Do not rewrite the entire application or delete existing workflows.

Implement the new Two Screen Comparison tab as a separate, reusable feature. The default comparison scope must be Data & Text only. Offer optional checkboxes for Images & Diagrams, CSS & Visual Styling, Alignment & Layout, and Form Elements & States. Build a modular analyzer pipeline that runs only selected checks, matches screenshot regions, extracts visible data, identifies meaningful differences, highlights both screenshots, and generates structured reports. Use existing frameworks/services where possible; do not hardcode DEV/PROD sample values or URLs. If a robust OCR/vision backend is unavailable, clearly mark the feature as incomplete rather than returning fabricated AI findings. Add automated tests for the acceptance criteria, run them, and report what works, what remains unsupported, and how to use the new tab.

Priority rule: data correctness > image/diagram correctness > optional styling/layout. Minor CSS and alignment differences must never dominate the default report.

### 10. Merge guidance for existing SKILL.md
Copy this document into the existing QA Vision skill's requirements or feature-specification section. If the skill has YAML frontmatter or required skill metadata, preserve it. Avoid duplicate/conflicting instructions. Keep existing functionality descriptions, but clarify that this new tab is manual screenshot-vs-screenshot comparison, independent from any live browser synchronization feature. If the skill points to a references folder, this specification can be placed at references/two-screen-comparison.md and linked from SKILL.md.

**This section supersedes the previous section 7. The Two Screen Comparison tab is now data-first per this specification. Existing deterministic pixelmatch + AI explanation features are retained as the foundation; the pipeline has been extended with selectable scope and prioritized data extraction where possible.**

**Status:** Implemented 2026-11-27: data-first scope selection, local OCR (Tesseract) data extraction, deterministic pixel checks for the visual scopes, optional AI step. Verified by `tests/unit/screenshot-data.test.js`, `screenshot-data-ocr.test.js`, `screenshot-compare.test.js` and `npm run test:ui:screenshot` (headless Chromium against the running dashboard). See root README "Two Screen Comparison (screenshots)" for usage and limitations (PDF via browser print).  
**Priority:** New independent tab in the existing QA Vision application.  
**Scope:** Compare two uploaded or pasted screenshots; **no live URLs, login, browser synchronization, or Playwright required for this tab.**  
**Goal:** Add a tab named **Two Screen Comparison** to the existing QA Vision Master. A QA engineer provides a screenshot of a DEV page (new changes) and a screenshot of the corresponding known-good PROD page. The system identifies and explains visible matches and mismatches, highlights them on screenshots, and generates an evidence-based report. The existing application and other tabs must remain intact; do not depend on or repair the existing live comparison feature to deliver this tab.

### User Workflow
1. Open QA Vision → **Two Screen Comparison**.
2. In the **DEV Screenshot** panel (labeled "DEV (New Changes)"), paste an image from the clipboard (Ctrl+V) or upload/drag-and-drop PNG, JPG, or WebP.
3. In the **PROD Screenshot** panel (labeled "PROD (Reference)"), paste or upload the corresponding reference screenshot. Each panel must have its own replace, preview, zoom, and remove controls. The pasted image must go to the selected/focused panel, never an ambiguous destination.
4. Optionally enter page name, environment labels, expected intentional differences, ignore regions, and comparison sensitivity.
5. Click **Compare Screenshots**. Show processing status and meaningful errors; do not claim a comparison has run unless both valid images are present.
6. Display side-by-side originals, an optional overlay/slider, and an annotated screenshot for each side with numbered, color-coded mismatch boxes.
7. Show a report with categories, exact visible evidence, confidence, severity suggestions, and location of each difference. Allow the user to mark findings as expected, false positive, or confirmed defect.
8. Download a self-contained HTML report and machine-readable JSON; optional PDF and annotated PNG exports. Allow **Reset** and repeat with any new pair of screenshots.

### Illustrative Sample Findings
Finding | DEV | PROD | Initial classification
---|---|---|---
Login button color | Emerald | Blue | Expected visual difference
Active users | 1,250 | 1,248 | Data difference; verify normalization
Email validation | Friendly message | Invalid email | Expected or review-needed text difference
Add User | Enabled | Disabled | Expected production safety policy
Chart | Experimental | Stable | Expected feature difference

### Comparison Categories
- **Text/content**: missing, extra, altered, misspelled or truncated labels, headings, buttons, placeholders, messages, and visible table cells.
- **Data**: visible numeric, monetary, percentage, date, status, count, and table-value differences. Compare exact extracted strings and optionally normalized values; never infer database correctness from screenshots alone.
- **Typography**: font-family appearance (estimate), size, weight, line height, casing, and text alignment. State when exact font identity cannot be determined from pixels.
- **Colors**: text, backgrounds, buttons, borders, icons and other visible elements; use sampled colors with tolerance, not invented CSS values.
- **Layout**: moved, resized, overlapping, clipped, missing, or extra visible components; padding, margins, spacing, alignment, and responsive shifts.
- **Visual assets**: missing/different icons, logos, illustrations, chart appearance, and image content.
- **State**: visibly enabled/disabled, selected/unselected, checked/unchecked, validation and modal differences, only where observable in pixels.
- **Matches**: summarize visually consistent regions and overall similarity; avoid declaring pixel identity equivalent to functional correctness.

### Comparison Pipeline (Deterministic-First)
1. Validate image type, decode successfully, limit upload size/pixel count (e.g. < 10MB, < 4K resolution), strip sensitive metadata, keep images isolated per comparison session (in-memory or temp files only).
2. Detect dimensions, resolution and device pixel ratio differences. Offer alignment/crop and scaling controls. Warn when pages show different scroll positions, viewports, zoom levels, personalization, or loading states.
3. Align screenshots using stable landmarks/features when possible. **Preserve originals**. Never silently distort an image to force a match.
4. Compute pixel/perceptual difference maps (pixelmatch + sharp, SSIM-style with anti-aliasing tolerance) and group contiguous regions into bounding boxes.
5. Use OCR (if Tesseract or similar added) or a capable vision model to extract visible text and associate text boxes; compare values and locations. Readings must be confidence-rated and editable by the user.
6. Match corresponding components using geometry, text and visual similarity. Distinguish moved elements from added/missing elements.
7. Apply ignore masks and configured tolerances for dynamic clocks, timestamps, avatars, rotating banners, and other expected differences.
8. Optionally send minimal relevant image crops + structured evidence to the configured Grok vision-capable API (`grok-4` family or equivalent that supports images). Verify the selected model supports image inputs; if not, provide deterministic visual comparison only and clearly document the limitation. **Do not rely on AI-only claims without image evidence**.
9. De-duplicate overlapping findings and assign stable IDs, bounding boxes (for DEV and/or PROD), category, evidence, suggested severity, confidence, expected/actual values where readable.
10. Render annotations and export findings. Retain the original screenshots unchanged for auditability.

### Report Schema (Minimum)
Each finding: `id`, `category`, `title`, `dev_observation`, `prod_observation`, `dev_bbox` (nullable), `prod_bbox` (nullable), `evidence`, `confidence`, `severity_suggestion`, `review_status` (`expected`|`false-positive`|`confirmed-defect`|`needs-review`), `ignored_by_rule`, `image_ids`.  
Bounding boxes must specify coordinate system and source-image dimensions.  
Include: session ID, comparison time, image dimensions, configured tolerance, model name (if used), **limitations**, totals by category, reviewed/confirmed totals.  
**Do not fabricate** DOM selectors, CSS classes, API responses, computed CSS values, or actual underlying data — screenshots cannot reveal those reliably.

### UI Requirements
- Two equal panels labeled **DEV (New Changes)** and **PROD (Reference)**, with visible upload and paste instructions ("Ctrl+V or drop image").
- Clear **Compare Screenshots** button (disabled until both images are valid).
- Zoom/pan (react-zoom-pan-pinch or CSS transform), side-by-side, transparency overlay or before/after slider, toggle annotation layers.
- Clickable finding list that scrolls/zooms/highlights the corresponding region on both images.
- Filters by category, confidence, severity, review status; show matched + mismatched summaries.
- Colorblind-accessible annotation labels (numbers + icons, not color alone).
- Useful empty state, loading spinner with progress, error states ("Invalid image", "Different aspect ratios — alignment required", "No differences within tolerance"), and "No material differences" celebration.
- Works with **arbitrary** page screenshots; no hardcoded text, domains, or sample values.

### Security & Privacy (Mandatory)
- Warn prominently that screenshots may contain PII/credentials. Provide **local-only deterministic mode** (default). Require explicit consent before any third-party API call.
- Store API keys server-side only (extend existing secret/profile system). Never embed keys in browser code or reports.
- Redact secrets in any extracted text before AI or reports. Enforce upload limits, no persistent storage of user screenshots beyond the current session.
- This tab performs **no** interaction with live websites or state-changing actions.

### Acceptance Tests (Must Pass)
- Independent upload/paste to each panel (clipboard targets focused panel).
- Identical images → "No material differences within tolerance".
- One changed label/number/color/font/position → each difference localized with bbox, no unrelated duplicates.
- Different dimensions → clear warning + alignment option; no false "clean match".
- Ignore region (clock) → change excluded and logged in report.
- Missing icon → correct side and bbox.
- Click finding → highlights correct region; annotations stay accurate after zoom/pan.
- Bad image → actionable error.
- Grok unavailable → deterministic fallback with clear note.
- Exports (JSON + self-contained HTML) preserve findings, bboxes, annotations, originals.
- Existing tabs (Profiles, Live Comparison, etc.) and all live Playwright functionality remain 100% unchanged.

### Out of Scope for This Tab
Live browser control, automatic login, DEV→PROD action replay, network/API inspection, DOM/computed-style inspection, hidden elements, backend data parity, functional correctness. Those remain in the separate live comparison feature.

### Implementation Guidance for Any Coding Agent
Inspect the current repository and locate its tab/navigation components (`app/page.tsx` activeTab and nav array), screenshot/image handling (`LiveView.tsx` paste, `EvidenceViewer.tsx`, `/api/evidence`), API architecture (`app/api/*`), existing AI integration (`lib/engine/ai.ts`, reports), and types.  
**Add the new tab as a completely separate feature module** (`app/components/ScreenshotComparison.tsx` + new API route) **without rewriting the existing live DEV/PROD comparison**.  
First document the code paths and implementation gaps in your response.  
Build in this order: image input/preview/paste logic → deterministic image diff + region detection → annotation overlay → AI explanation adapter (optional) → report generation/exports → tests.  
Keep image processing and optional Grok calls modular.  
After each phase, run the app in the browser, test the new tab end-to-end, update tests, and report actual results + candid limitations (e.g. "No native OCR yet; using pixelmatch + canvas text detection as baseline").  
Provide exact file changes via edits, how to run locally (`npm run start:real`), sample test images (place in `public/test-screenshots/`), test results, and a list of known limitations.  
**Never claim features are working without running the relevant checks in the browser.** Do not replace unrelated project files or remove existing tabs.

**Local-only deterministic comparison using existing `pixelmatch`, `sharp`, and canvas is the MVP baseline.** Vision model support is progressive enhancement.

---

## 9. Updated How to Use This Skill (Post Data-First Update)

**When the user asks anything about QA Vision, Two Screen Compare, screenshot comparison, DEV vs PROD comparison, or related work:**
1. Read this entire file first (the Data-First Two Screen Comparison spec in section 8 is now the highest priority requirement).
2. Read the current `qa-vision/README.md` and root `README.md`.
3. Inspect the actual codebase with tools before making any changes.
4. Follow the Master Prompt rules (preserve live comparison, dynamic profiles, safety, tests). Extend the screenshot tab per the data-first spec above without deleting or rewriting unrelated code.
5. The default must be Data & Text only. Run only selected categories. Prioritize data mismatches in reports.
6. Verify all changes in the browser (end-to-end flows for the tab, including checkboxes, different scopes, data vs styling). Confirm no regressions in other tabs.
7. Run `npm run build:engine`, tests, and document what is implemented vs. unsupported (e.g. full OCR/tables may be limited without additional backend; mark clearly).
8. Update tests to cover the new acceptance criteria.

This file is the single source of truth. All previous specs are superseded by the data-first requirements in section 8.

When the user asks anything about QA Vision, Two Screen Compare, **screenshot comparison**, DEV vs PROD, or related work:
1. **Read this entire file first** (now includes the new screenshot tab as highest-priority independent feature).
2. Read the current `qa-vision/README.md` and root `README.md`.
3. Inspect the actual codebase with tools before making any changes.
4. Follow the Master Prompt + new screenshot tab rules above (preserve live comparison, add new tab independently, deterministic-first, verify in browser).
5. Prioritize the new **Two Screen Comparison** tab implementation per the addendum.
6. After changes, verify the new tab in the browser (upload/paste/compare/export) **and** confirm existing live comparison still works.
7. Run relevant tests and document limitations.

This file is the single source of truth. All previous specs are superseded.

**End of QA VISION MASTER Skill**
