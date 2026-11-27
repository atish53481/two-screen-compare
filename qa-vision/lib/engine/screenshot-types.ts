/**
 * Types for the independent Two Screen Comparison tab (screenshot vs screenshot, no live browser).
 * Dependency-free so client components can import them without pulling sharp/pngjs into the browser bundle.
 */

export type ShotCategory = 'text' | 'data' | 'typography' | 'color' | 'layout' | 'visual' | 'state' | 'match';
export type ShotReviewStatus = 'expected' | 'false-positive' | 'confirmed-defect' | 'needs-review';

/** What the user asked to compare ("What do you want to compare?"). Only selected scopes run or report. */
export type ShotScope = 'data_text' | 'images_diagrams' | 'css_styling' | 'alignment_layout' | 'form_states';
/** All scopes in report priority order: data > images/diagrams > optional styling/layout/forms. */
export const SHOT_SCOPES: ShotScope[] = ['data_text', 'images_diagrams', 'css_styling', 'alignment_layout', 'form_states'];
export const DEFAULT_SHOT_SCOPE: ShotScope[] = ['data_text'];
export const SHOT_SCOPE_INFO: Record<ShotScope, { label: string; priority: 'P1' | 'P2' | 'P3'; code: string; description: string }> = {
  data_text: { label: 'Data & Text', priority: 'P1', code: 'DATA', description: 'Visible business values, table cells, labels, numbers, dates, currencies, statuses, IDs, totals, counts, error messages' },
  images_diagrams: { label: 'Images & Diagrams', priority: 'P2', code: 'IMG', description: 'Missing/wrong images, charts, icons with business meaning, diagram nodes, labels, legends' },
  css_styling: { label: 'CSS & Visual Styling', priority: 'P3', code: 'CSS', description: 'Colors, font size/weight, borders, backgrounds, element styling (visual estimates)' },
  alignment_layout: { label: 'Alignment & Layout', priority: 'P3', code: 'LAY', description: 'Element positions, dimensions, overlap, clipping, misalignment' },
  form_states: { label: 'Form Elements & States', priority: 'P3', code: 'FORM', description: 'Checked/selected states, enabled/disabled appearance, missing controls (visual estimates)' },
};
/** Which scope each finding category belongs to. */
export const CATEGORY_SCOPE: Record<Exclude<ShotCategory, 'match'>, ShotScope> = {
  data: 'data_text',
  text: 'data_text',
  visual: 'images_diagrams',
  color: 'css_styling',
  typography: 'css_styling',
  layout: 'alignment_layout',
  state: 'form_states',
};

/** Outcome of one finding (independent of the user's review decision). */
export type ShotFindingStatus = 'mismatch' | 'uncertain' | 'missing-in-dev' | 'extra-in-dev' | 'matched' | 'ignored';
export type ShotValueType = 'number' | 'currency' | 'percent' | 'date' | 'identifier' | 'status' | 'text';

/** Text/data matching rules (Data & Text scope). */
export interface ShotTextOptions {
  /** normalized: safe presentation variants are equal (1,250 = 1250, $1,250.00 = $1250, case, spacing). strict: exact text. */
  matching: 'normalized' | 'strict';
  caseSensitive: boolean;
  /** Absolute tolerance for numbers/amounts/percentages (normalized mode). */
  numericTolerance: number;
  /** OCR word confidence (0-100) below which a reading is "Uncertain / Needs review" instead of a mismatch. */
  minConfidence: number;
  /** Labels/text to exclude (case-insensitive substring, or /regex/). Logged in the report. */
  ignoreFields: string[];
}
export const DEFAULT_TEXT_OPTIONS: ShotTextOptions = { matching: 'normalized', caseSensitive: false, numericTolerance: 0, minConfidence: 60, ignoreFields: [] };
export type ShotSeverity = 'low' | 'medium' | 'high';
export type ShotSensitivity = 'strict' | 'normal' | 'relaxed';
/** How to compare screenshots of different sizes. 'none' refuses and asks the user to choose. */
export type ShotAlignment = 'none' | 'top-left' | 'scale';

export interface ShotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box in one source image. Coordinates are pixels from that image's top-left corner, in its original size. */
export interface ShotBBox extends ShotRect {
  sourceWidth: number;
  sourceHeight: number;
  coordinateSystem: 'source-pixels-top-left';
}

/** A region excluded from comparison, in DEV source pixels (same as PROD pixels once aligned). */
export interface ShotIgnoreRegion extends ShotRect {
  label: string;
}

export interface ShotAiReading {
  explanation: string;
  devText?: string;
  prodText?: string;
  suggestedCategory?: ShotCategory;
}

export interface ScreenshotFinding {
  /** Stable id: derived from category + location, so the same difference gets the same id on a re-run. */
  id: string;
  /** Display number used on the annotations (1-based, in report priority order). 0 for summary findings. */
  number: number;
  /** Human code per scope, e.g. DATA-001, IMG-002, CSS-001. */
  code: string;
  /** The comparison scope that produced this finding (null for summary/ignored entries). */
  scope: ShotScope | null;
  status: ShotFindingStatus;
  category: ShotCategory;
  title: string;
  /** Data findings: the visible label/column the value belongs to, when it could be determined. */
  field?: string;
  pageSection?: string;
  /** Data findings: exact visible text as read by OCR (null when absent on that side). */
  devValue?: string | null;
  prodValue?: string | null;
  valueType?: ShotValueType;
  expectedBaseline?: string;
  reviewNote?: string;
  devObservation: string;
  prodObservation: string;
  devBbox: ShotBBox | null;
  prodBbox: ShotBBox | null;
  evidence: string;
  confidence: number;
  severitySuggestion: ShotSeverity;
  reviewStatus: ShotReviewStatus;
  ignoredByRule: string | null;
  imageIds: { dev: string; prod: string };
  /** Measured values behind the finding (sampled colors, pixel counts, offsets). Never invented CSS/DOM values. */
  metrics?: Record<string, string | number>;
  /** Optional, advisory only: present when the user consented to AI and a vision model answered. */
  ai?: ShotAiReading;
}

export interface ShotIgnoredLogEntry {
  label: string;
  rect: ShotRect;
  suppressedPixels: number;
  /** OCR text items inside the region that were excluded from the data comparison. */
  suppressedTextItems?: number;
}

export interface ShotIgnoredFieldEntry {
  rule: string;
  devItems: string[];
  prodItems: string[];
}

export interface ShotScopeSummary {
  checked: boolean;
  findings: number;
  mismatches: number;
  uncertain: number;
}

export interface ScreenshotComparisonResult {
  sessionId: string;
  timestamp: string;
  status: 'compared' | 'no-differences' | 'alignment-required';
  pageName: string;
  devLabel: string;
  prodLabel: string;
  expectedNotes: string;
  devImageId: string;
  prodImageId: string;
  devDimensions: { width: number; height: number };
  prodDimensions: { width: number; height: number };
  /** The pixel grid both images were compared on. */
  canvas: { width: number; height: number };
  alignment: { mode: ShotAlignment; required: boolean; description: string; prodScaleX: number; prodScaleY: number };
  /** Selected comparison scopes; nothing outside them was run or reported. */
  scope: ShotScope[];
  settings: {
    sensitivity: ShotSensitivity;
    pixelThreshold: number;
    minRegionPixels: number;
    ignoreRegions: ShotIgnoreRegion[];
    text: ShotTextOptions;
  };
  /** Whether the pixel diff ran (skipped when only Data & Text is selected and the sizes differ). */
  pixelAnalysis: boolean;
  ocr: { requested: boolean; used: boolean; engine: string | null; note: string; devTextItems: number; prodTextItems: number; durationMs: number };
  warnings: string[];
  findings: ScreenshotFinding[];
  ignoredLog: ShotIgnoredLogEntry[];
  ignoredFields: ShotIgnoredFieldEntry[];
  summary: {
    byScope: Record<ShotScope, ShotScopeSummary>;
    /** Text/data items read on both sides and found equal. */
    matchedItems: number;
    confirmedMismatches: number;
    uncertainItems: number;
    /** OCR readings that differed while the pixels were unchanged: treated as OCR noise, not reported. */
    ocrNoiseSuppressed: number;
    totalFindings: number;
    matches: number;
    mismatchesByCategory: Record<string, number>;
    diffPercent: number;
    similarityPercent: number;
    identicalZones: number;
    totalZones: number;
    subThresholdPixels: number;
    limitations: string[];
  };
  ai: { requested: boolean; used: boolean; provider: string | null; model: string | null; note: string };
  evidence: {
    /** Changed pixels in red over a dimmed DEV image, ignore regions tinted blue (canvas size). */
    diffPngBase64?: string;
    /** Present when alignment changed the images: both sides on the shared canvas, for overlay/slider views. */
    devCanvasPngBase64?: string;
    prodCanvasPngBase64?: string;
  };
}

export const SHOT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxPixels: 16_777_216, // 4096 x 4096 equivalent; tall full-page shots are fine up to this pixel count
  maxEdge: 16384,
  formats: ['png', 'jpeg', 'webp'] as const,
};
